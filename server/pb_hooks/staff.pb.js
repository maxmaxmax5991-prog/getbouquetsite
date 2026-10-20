/// <reference path="../pb_data/types.d.ts" />
// Кабинет менеджеров: отметка «я тут», линия, сотрудники, ответственный за заказ.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня этого файла —
// всё общее лежит в lib/staff.js и подключается внутри обработчика.

// Отметка «я за экраном». Админка дёргает раз в полминуты; в ответ — кто сейчас
// в сети, чтобы точки у ников обновлялись без отдельного запроса.
routerAdd("POST", "/api/shop/beat", (e) => {
  const st = require(`${__hooks}/lib/staff.js`);
  const я = st.нынешний($app, e);
  if (!я) return e.json(403, { message: "Войдите заново." });
  st.отметиться($app, я.id);
  return e.json(200, { ok: true, линия: я.get("line") || "", люди: st.живые($app) });
}, $apis.requireAuth("managers"));

// «На линии» / «Занят». Занятому автоназначение новых заказов не даёт.
routerAdd("POST", "/api/shop/line", (e) => {
  const st = require(`${__hooks}/lib/staff.js`);
  const я = st.нынешний($app, e);
  if (!я) return e.json(403, { message: "Войдите заново." });
  const v = String((e.requestInfo().body || {}).line || "");
  if (["on", "busy", ""].indexOf(v) < 0) return e.json(400, { message: "Такого состояния нет." });
  try {
    $app.db().newQuery("UPDATE managers SET line = {:v}, seen_at = {:t} WHERE id = {:id}")
      .bind({ v, t: new Date().toISOString(), id: я.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  return e.json(200, { ok: true, линия: v });
}, $apis.requireAuth("managers"));

// Взять заказ на себя, передать другому или вернуть в общий котёл.
routerAdd("POST", "/api/shop/order-take", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const я = st.нынешний($app, e);
  const b = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }

  const былId = o.get("manager") || "";
  let кому = "", имя = "";
  if (b.to === "" || b.to === null) { кому = ""; имя = "никто"; }
  else {
    const id = String(b.to || (я && я.id) || "");
    let r; try { r = $app.findRecordById("managers", id); } catch (_) { return e.json(404, { message: "Сотрудник не найден" }); }
    кому = r.id; имя = r.get("name") || r.get("nick") || "";
  }
  if (кому === былId) return e.json(200, { ok: true, manager: кому });
  try {
    $app.db().newQuery(`UPDATE orders SET manager = {:m}, manager_at = {:t}, manager_how = {:h} WHERE id = {:id}`)
      .bind({ m: кому, t: кому ? new Date().toISOString() : "", h: кому ? "hand" : "", id: o.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }

  let былИмя = "никто";
  if (былId) { try { const r = $app.findRecordById("managers", былId); былИмя = r.get("name") || r.get("nick"); } catch (_) { былИмя = "кто-то"; } }
  st.запись($app, o, я, "ответственный", `${былИмя} → ${имя}`);
  return e.json(200, { ok: true, manager: кому });
}, $apis.requireAuth("managers"));

// Лента правок заказа.
routerAdd("GET", "/api/shop/order-log", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const id = String(e.request.url.query().get("order") || "");
  let r = [];
  try { r = $app.findRecordsByFilter("order_log", "order = {:o}", "-at", 200, 0, { o: id }); } catch (_) {}
  return e.json(200, { строки: r.map((x) => ({
    at: x.get("at"), nick: x.get("nick"), action: x.get("action"), text: x.get("text"),
  })) });
}, $apis.requireAuth("managers"));

// Новый заказ — сразу назначаем ответственного и открываем ленту.
onRecordAfterCreateSuccess((e) => {
  try {
    const st = require(`${__hooks}/lib/staff.js`);
    st.запись($app, e.record, null, "создан", `Заказ №${e.record.get("number")} на ${e.record.get("total")} ₽`);
    // Назначаем при создании, а не после оплаты: кто-то должен дожимать оплату.
    st.назначить($app, e.record);
  } catch (err) { console.log("staff: новый заказ", err); }
}, "orders");

// Сводка за сегодня: общие числа и строка на каждого менеджера.
//
// «Просрочек 3 мин» считаем по переписке: сообщение покупателя, на которое
// ответили позже трёх минут (или ещё не ответили). Вешаем на того, кто в итоге
// ответил; неотвеченные — на ответственного за диалог, а если его нет — в
// общий счётчик. Считать можно только с того дня, как начали записывать автора
// ответа: до этого в базе пусто, и прошлые дни покажут нули.
routerAdd("POST", "/api/shop/team-day", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const день = String(b.day || shop.moscowToday());
  // сутки по Москве: в базе время по Гринвичу, поэтому берём с 21:00 предыдущего
  const с = new Date(new Date(`${день}T00:00:00+03:00`)).toISOString().replace("T", " ").slice(0, 19);
  const по = new Date(new Date(`${день}T23:59:59+03:00`)).toISOString().replace("T", " ").slice(0, 19);

  let заказы = [];
  try { заказы = $app.findRecordsByFilter("orders", "created >= {:a} && created <= {:b}", "created", 1000, 0, { a: с, b: по }); } catch (_) {}
  const поЛюдям = {};
  const строка = (id) => (поЛюдям[id] = поЛюдям[id] || { взял: 0, закрыл: 0, отменил: 0, сумма: 0, просрочек: 0 });

  let сумма = 0, оплачено = 0, отменено = 0, ничьих = 0;
  заказы.forEach((o) => {
    const отм = o.get("status") === "cancelled";
    if (!отм) сумма += +o.get("total") || 0;
    if (o.get("payment_status") === "paid") оплачено++;
    if (отм) отменено++;
    const m = o.get("manager") || "";
    if (!m) { ничьих++; return; }
    const r = строка(m);
    r.взял++;
    if (o.get("status") === "done") r.закрыл++;
    if (отм) r.отменил++; else r.сумма += +o.get("total") || 0;
  });

  // просрочки по переписке
  let сообщения = [];
  try { сообщения = $app.findRecordsByFilter("chat_messages", "created >= {:a} && created <= {:b}", "created", 3000, 0, { a: с, b: по }); } catch (_) {}
  const поДиалогам = {};
  сообщения.forEach((m) => { (поДиалогам[m.get("chat")] = поДиалогам[m.get("chat")] || []).push(m); });
  let просрочекВсего = 0;
  Object.keys(поДиалогам).forEach((cid) => {
    const список = поДиалогам[cid];
    let ждёт = null;
    список.forEach((m) => {
      const t = Date.parse(String(m.get("created")).replace(" ", "T"));
      if (m.get("side") === "client") { if (!ждёт) ждёт = t; return; }
      if (ждёт) {
        if (t - ждёт > 3 * 60000) { просрочекВсего++; const a = m.get("author") || ""; if (a) строка(a).просрочек++; }
        ждёт = null;
      }
    });
    // так и не ответили до конца суток
    if (ждёт && Date.now() - ждёт > 3 * 60000) просрочекВсего++;
  });

  return e.json(200, {
    заказов: заказы.length, сумма, оплачено, отменено, ничьих,
    чек: заказы.length ? Math.round(сумма / Math.max(1, заказы.length - отменено)) : 0,
    просрочекВсего, поЛюдям,
  });
}, $apis.requireAuth("managers"));
