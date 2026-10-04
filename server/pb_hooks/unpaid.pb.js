/// <reference path="../pb_data/types.d.ts" />
// Брошенная оплата: напоминаем, гасим через час, возвращаем цветы в продажу.
// Разбор, сроки и тексты — в lib/unpaid.js.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня файла,
// поэтому всё общее лежит в lib/ и подключается внутри обработчика.

// Обход раз в пять минут. Внутри часа уходят два напоминания, по истечении —
// заказ гаснет и стебли возвращаются на склад.
cronAdd("unpaid", "*/5 * * * *", () => {
  try {
    const итог = require(`${__hooks}/lib/unpaid.js`).обход($app);
    if (итог && (итог.напомнили || итог.погасили)) {
      console.log(`unpaid: напомнили ${итог.напомнили}, погасили ${итог.погасили}, вернули ${итог.стеблей} стеблей`);
    }
  } catch (err) { console.log("unpaid cron", err); }
});

// Отменили руками в админке или статусом из МоегоСклада — цветы тоже должны
// вернуться. Раньше не возвращались нигде и никогда: за неделю так заперлось
// 3322 стебля, и сайт отказывал покупателям «осталось 0», хотя цветы лежали.
onRecordAfterUpdateSuccess((e) => {
  try {
    if (String(e.record.get("status")) === "cancelled") {
      const было = e.record.original();
      if (!было || String(было.get("status")) !== "cancelled") {
        const n = require(`${__hooks}/lib/unpaid.js`).вернутьОстатки($app, e.record);
        if (n) console.log(`unpaid: заказ №${e.record.get("number")} отменён, вернули ${n} стеблей`);
      }
    }
  } catch (err) { console.log("unpaid cancel", err); }
  e.next();
}, "orders");

// Сколько сейчас висит неоплаченных и что с ними — для админки
routerAdd("GET", "/api/shop/unpaid", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head", "manager", "care"])) return e.json(403, { message: "Недостаточно прав." });
  const s = shop.settings($app);
  let список = [];
  try {
    список = $app.findRecordsByFilter("orders",
      `payment_method = "card" && payment_status != "paid" && status != "cancelled"`,
      "-created", 50, 0);
  } catch (err) { return e.json(500, { message: String(err) }); }
  const ttl = require(`${__hooks}/lib/unpaid.js`).срок(s);
  return e.json(200, { ttl, items: список.map((o) => ({
    id: o.id, number: o.get("number"), total: o.get("total"), name: o.get("name"), phone: o.get("phone"),
    created: o.get("created"), reminds: +o.get("reminds") || 0, tries: +o.get("pay_tries") || 0,
    error: o.get("pay_error") || "", delivery_type: o.get("delivery_type"), date: o.get("date"), interval: o.get("interval"),
  })) });
});

// Разбор старого завала: вернуть цветы с давно брошенных заказов. Без `go`
// только считает, ничего не трогая, — чтобы владелец сначала увидел цифру.
// Сообщений покупателям не шлёт: повод давно прошёл.
routerAdd("POST", "/api/shop/unpaid-release", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const r = require(`${__hooks}/lib/unpaid.js`).разобратьЗавал($app, +b.minutes || 180, !!b.go);
  if (!r.ok) return e.json(500, { message: r.error });
  return e.json(200, r);
});

// Включить машинку напоминаний с этого момента. Отдельной кнопкой, чтобы она
// никогда не завелась сама и не написала людям из прошлого.
routerAdd("POST", "/api/shop/unpaid-start", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const v = b.off ? "" : new Date().toISOString();
  try {
    const s = shop.settings($app);
    $app.db().newQuery("UPDATE settings SET unpaid_from = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  return e.json(200, { ok: true, from: v });
});

// Покупатель открыл окно оплаты или банк отказал — записываем. Без этого мы не
// отличаем «закрыл окно» от «карту отклонили», а это разные люди и разные письма.
routerAdd("POST", "/api/shop/pay-try", (e) => {
  const b = e.requestInfo().body || {};
  const id = String(b.order || "");
  if (!id) return e.json(400, { message: "Нет заказа." });
  let o;
  try { o = $app.findRecordById("orders", id); } catch (_) { return e.json(404, { message: "Заказ не найден." }); }
  const ошибка = String(b.error || "").slice(0, 300);
  try {
    if (ошибка) {
      $app.db().newQuery("UPDATE orders SET pay_tries = IFNULL(pay_tries,0) + 1, pay_error = {:err}, pay_error_at = {:t} WHERE id = {:id}")
        .bind({ err: ошибка, t: new Date().toISOString(), id: o.id }).execute();
    } else {
      $app.db().newQuery("UPDATE orders SET pay_tries = IFNULL(pay_tries,0) + 1 WHERE id = {:id}").bind({ id: o.id }).execute();
    }
  } catch (err) { console.log("pay-try", err); }
  return e.json(200, { ok: true });
});
