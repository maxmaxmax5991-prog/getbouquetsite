/// <reference path="../pb_data/types.d.ts" />
// Брошенная оплата: напоминаем, гасим через час, возвращаем цветы в продажу.
// Разбор, сроки и тексты — в lib/unpaid.js.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня файла,
// поэтому всё общее лежит в lib/ и подключается внутри обработчика.

// Обход раз в пять минут. Внутри часа уходят два напоминания, по истечении —
// заказ гаснет и стебли возвращаются на склад.
// Звонок по горячему следу: раз в минуту смотрим, не завис ли свежий заказ.
// Отдельно от машинки напоминаний: та включается рубильником и шлёт письма
// покупателю, а этот сигнал нужен всегда и идёт менеджеру.
cronAdd("call-now", "* * * * *", () => {
  try {
    const r = require(`${__hooks}/lib/callnow.js`).проверить($app);
    if (r.позвали) console.log("звонок по оплате: позвали по", r.позвали, "заказам");
  } catch (err) { console.log("звонок по оплате", err); }
});

// Опрос бота обзвона: ловим нажатия кнопок «обещал / не берёт / отказался».
cronAdd("call-bot", "* * * * *", () => {
  try { require(`${__hooks}/lib/callnow.js`).опрос($app); }
  catch (err) { console.log("бот обзвона", err); }
});

cronAdd("unpaid", "*/5 * * * *", () => {
  try {
    const итог = require(`${__hooks}/lib/unpaid.js`).обход($app);
    // Пишем строку на каждом обходе, где есть кого смотреть, а не только когда
    // что-то сделали. Месяц машинка молчала и выглядела работающей именно
    // потому, что молчание ничем не отличалось от «сегодня никто не бросил».
    if (итог && (итог.всего || итог.напомнили || итог.погасили)) {
      console.log(`unpaid: в работе ${итог.всего || 0}, напомнили ${итог.напомнили}, погасили ${итог.погасили}, вернули ${итог.стеблей} стеблей, пропустили ${итог.пропустили}`);
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
        // Отменили УЖЕ ОПЛАЧЕННЫЙ заказ — надо решить судьбу денег. Без ответа
        // нельзя ни чек возврата пробить, ни кассу свести: за месяц так
        // накопилось 23 заказа на 204 778 ₽, по которым никто не знает, вернули
        // мы деньги или нет. Спрашиваем сразу, кнопками, пока помнят.
        if (e.record.get("payment_status") === "paid" && !String(e.record.get("refund") || "")) {
          try {
            const shop = require(`${__hooks}/lib/shop.js`);
            const s = shop.settings($app);
            shop.adminIds(s).forEach((c) => shop.tg(s.get("tg_token"), "sendMessage", {
              chat_id: c,
              text: `↩️ Отменён оплаченный заказ №${e.record.get("number")} на ${shop.rub(e.record.get("total"))}.\n\nЧто с деньгами?`,
              reply_markup: { inline_keyboard: [[
                { text: "💸 Вернули покупателю", callback_data: `rf:${e.record.id}:back` },
                { text: "Остались у нас", callback_data: `rf:${e.record.id}:keep` },
              ]] },
            }));
          } catch (err) { console.log("отмена: спросить про деньги", err); }
        }
      }
    }
  } catch (err) { console.log("unpaid cancel", err); }
  e.next();
}, "orders");

// Сколько сейчас висит неоплаченных и что с ними — для админки
routerAdd("GET", "/api/shop/unpaid", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head", "manager", "care"])) return e.json(403, { message: "Недостаточно прав." });
  const s = shop.settings($app);
  let список = [];
  try {
    список = $app.findRecordsByFilter("orders",
      `payment_method = "card" && payment_status != "paid" && status != "cancelled"`,
      "-created", 50, 0);
  } catch (err) { return e.json(500, { message: String(err) }); }
  const ttl = require(`${__hooks}/lib/unpaid.js`).срок(s);
  // Старьё в список обзвона не пускаем: звонить человеку про неоплаченный
  // заказ недельной давности бессмысленно, а 47 таких висяков от прежних
  // времён забивали бы экран и прятали свежие, по которым ещё можно успеть.
  const сутки = Date.now() - 24 * 3600e3;
  список = список.filter((o) => {
    const t = Date.parse(String(o.getString("created") || "").replace(" ", "T").replace(/Z?$/, "Z"));
    return !t || t >= сутки;
  });
  // Первый ли это заказ у человека. 97% брошенных оплат — именно первые:
  // такому звонить нужно в первую очередь, повторный почти наверняка доплатит сам.
  const впервые = (o) => {
    const хвост = String(o.get("phone") || "").replace(/\D/g, "").slice(-10);
    if (хвост.length !== 10) return true;
    try {
      return !$app.findRecordsByFilter("orders",
        `payment_status = "paid" && phone ~ {:t} && created < {:c}`, "-created", 1, 0,
        { t: хвост, c: o.getString("created") }).length;
    } catch (_) { return true; }
  };
  const минут = (o) => {
    const t = Date.parse(String(o.getString("created") || "").replace(" ", "T").replace(/Z?$/, "Z"));
    return t ? Math.round((Date.now() - t) / 60000) : 0;
  };
  return e.json(200, { ttl, items: список.map((o) => ({
    id: o.id, number: o.get("number"), total: o.get("total"), name: o.get("name"), phone: o.get("phone"),
    created: o.get("created"), reminds: +o.get("reminds") || 0, tries: +o.get("pay_tries") || 0,
    error: o.get("pay_error") || "", delivery_type: o.get("delivery_type"), date: o.get("date"), interval: o.get("interval"),
    first: впервые(o), mins: минут(o),
    call: o.get("call_result") || "", call_at: o.get("call_at") || "", call_by: o.get("call_by") || "",
  })) });
});

// Кто получает сигналы и кто просится. Имена спрашиваем у Телеграма, чтобы
// владелец видел людей, а не числа.
routerAdd("GET", "/api/shop/call-people", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const cn = require(`${__hooks}/lib/callnow.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const s = shop.settings($app);
  const token = String(s.get("call_token") || "").trim();
  const имя = (чат) => {
    if (!token) return "";
    try {
      const r = shop.tg(token, "getChat", { chat_id: чат });
      if (r && r.ok && r.result) {
        return [r.result.first_name, r.result.last_name].filter(Boolean).join(" ") || r.result.username || r.result.title || "";
      }
    } catch (_) {}
    return "";
  };
  return e.json(200, {
    есть: !!token,
    получатели: cn.разбор(s.get("call_chats")).map((c) => ({ chat: c, name: имя(c) })),
    заявки: cn.заявкиСписок(s),
    порог: +s.get("call_after") || 5,
  });
}, $apis.requireAuth("managers"));

// Подключить или отключить получателя сигналов
routerAdd("POST", "/api/shop/call-people", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const cn = require(`${__hooks}/lib/callnow.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const чат = String(b.chat || "").replace(/[^\d-]/g, "");
  if (!чат) return e.json(400, { message: "Не указан чат." });
  const s = shop.settings($app);
  let кому = cn.разбор(s.get("call_chats"));
  const заявки = cn.заявкиСписок(s).filter((z) => z.chat !== чат);
  if (b.off) кому = кому.filter((x) => x !== чат);
  else if (кому.indexOf(чат) < 0) кому.push(чат);
  try {
    $app.db().newQuery("UPDATE settings SET call_chats = {:c}, call_pending = {:p} WHERE id = {:id}")
      .bind({ c: кому.join(","), p: JSON.stringify(заявки), id: s.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  // Подключённому говорим об этом сами: человек написал боту и ждёт ответа
  if (!b.off) {
    try {
      shop.tg(s.get("call_token"), "sendMessage", { chat_id: чат,
        text: "Готово, вас подключили. Сюда будут приходить заказы, не оплаченные пять минут: имя, телефон и кнопки для итога звонка." });
    } catch (_) {}
  }
  return e.json(200, { ok: true, получателей: кому.length });
}, $apis.requireAuth("managers"));

// Проверка бота для обзвона: кто он и кому сейчас уходят сигналы.
routerAdd("POST", "/api/shop/call-bot-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const s = shop.settings($app);
  const { token, кому, свой } = require(`${__hooks}/lib/callnow.js`).адресаты($app, s);
  if (!token) return e.json(200, { сообщение: "Ключ не задан — сигналы идут в служебный бот." });
  const r = shop.tg(token, "getMe", {});
  const имя = r && r.ok && r.result ? "@" + r.result.username : "ключ не подошёл";
  if (!свой) return e.json(200, { сообщение: `Отдельный бот не задан, сигналы идут в служебный, получателей ${кому.length}` });

  // Пересылка чата: говорим не только «включено», но и дошло ли сообщение.
  // Иначе «включено» и «работает» легко оказываются разными вещами.
  const cn = require(`${__hooks}/lib/callnow.js`);
  const с = Math.min(23, Math.max(0, +s.get("call_chat_from") || 0));
  const по = Math.min(24, Math.max(0, +s.get("call_chat_to") || 0));
  let про = с === по ? "Пересылка чата выключена." : `Чат пересылается с ${с}:00 до ${по}:00 по Москве${cn.чатВечером($app, s) ? " — сейчас как раз это время" : " — сейчас не их время"}.`;

  let дошло = 0, беда = "";
  кому.forEach((c) => {
    const o = shop.tg(token, "sendMessage", { chat_id: c,
      text: "🔔 Проверка связи. Сюда приходят неоплаченные заказы, а вечером — сообщения из чата на сайте." });
    if (o && o.ok) дошло++; else if (!беда) беда = (o && (o.description || o.error)) || "не принял";
  });
  return e.json(200, { сообщение: `Бот обзвона: ${имя}. Получателей ${кому.length}, проверка дошла до ${дошло}.`
    + (беда ? ` Не дошло: ${беда}.` : "") + ` ${про}` });
}, $apis.requireAuth("managers"));

// Отметка о звонке по брошенной оплате. Кто позвонил, когда и чем кончилось.
// «Обещал оплатить» ещё и продлевает жизнь заказу: гасить букет под руками
// у менеджера, который только что договорился, — худшее, что можно сделать.
routerAdd("POST", "/api/shop/unpaid-call", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, ["owner", "sales", "head", "manager", "care"])) return e.json(403, { message: "Недостаточно прав." });
  const ИТОГИ = {
    promised: "обещал оплатить", later: "перезвонить позже", refused: "отказался",
    noanswer: "не берёт трубку", wrong: "номер не тот",
  };
  const b = e.requestInfo().body || {};
  const итог = String(b.result || "");
  if (!ИТОГИ[итог]) return e.json(400, { message: "Неизвестный итог звонка." });
  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const я = st.нынешний($app, e);
  const кто = я ? (я.get("name") || я.get("nick") || "") : "";
  // запросом, мимо хуков: обычное сохранение заказа будит уведомления и МойСклад
  try {
    $app.db().newQuery("UPDATE orders SET call_result = {:r}, call_at = {:a}, call_by = {:b} WHERE id = {:id}")
      .bind({ r: итог, a: new Date().toISOString(), b: кто, id: o.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  st.запись($app, o, я, "звонок по оплате", ИТОГИ[итог]);
  return e.json(200, { ok: true, подпись: ИТОГИ[итог] });
}, $apis.requireAuth("managers"));

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
