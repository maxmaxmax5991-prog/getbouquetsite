/// <reference path="../pb_data/types.d.ts" />
// Отправка заказов в МойСклад: очередь раз в минуту, проверка токена и ручная отправка из админки.

cronAdd("ms-push", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const s = shop.settings($app);
  if (!s.get("ms_enabled") || !s.get("ms_token")) return;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const list = $app.findRecordsByFilter("orders", `ms_id = "" && status != "cancelled" && created > {:since}`, "created", 20, 0, { since });
  list.forEach((o) => {
    try {
      const r = msl.pushOrder($app, o);
      if (!r.ok && !r.wait && o.get("ms_error") !== r.error) { o.set("ms_error", r.error); $app.save(o); }
    } catch (err) { console.log("ms-push", err); }
  });

  // Добор входящих платежей. Платёж создаётся один раз, сразу после оплаты;
  // если тогда не получилось (связь, перезапуск), повторить было некому —
  // и заказ в МоёмСкладе оставался оплаченным, но без денег. Так вышло с №3021.
  const noPay = $app.findRecordsByFilter("orders",
    `payment_status = "paid" && ms_id != "" && ms_payment_id = "" && created > {:since}`,
    "created", 20, 0, { since });
  noPay.forEach((o) => {
    try {
      const r = msl.addPayment($app, o);
      if (!r.ok && !r.wait) console.log("добор платежа", o.get("number"), r.error || "");
    } catch (err) { console.log("ms-pay", err); }
  });
});

// Проверка токена + списки организаций и складов для админки
routerAdd("POST", "/api/shop/ms-test", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const r = msl.refs(shop.settings($app));
  return r.ok ? e.json(200, r) : e.json(400, { message: r.error });
}, $apis.requireAuth("managers"));

// Кнопка «Отправить в МойСклад» у заказа
routerAdd("POST", "/api/shop/ms-push", (e) => {
  const msl = require(`${__hooks}/lib/ms.js`);
  const body = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(body.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const r = msl.pushOrder($app, o);
  if (!r.ok) { o.set("ms_error", r.error); $app.save(o); return e.json(400, { message: r.error }); }
  if (o.get("payment_status") === "paid") { msl.markPaid($app, o); msl.addPayment($app, o); }   // статус и входящий платёж
  return e.json(200, { ok: true, ms_id: r.id });
}, $apis.requireAuth("managers"));

// Заменить сорт в позиции заказа. Флорист собрал букет из другого сорта —
// деньги и количество те же, но в МоёмСкладе должна списаться правильная номенклатура.
routerAdd("POST", "/api/shop/order-swap", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const b = e.requestInfo().body || {};

  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const items = shop.jget(o, "items") || [];
  const i = +b.index;
  if (!(i >= 0 && i < items.length)) return e.json(400, { message: "Нет такой позиции в заказе" });

  let p;
  try { p = $app.findRecordById("products", String(b.product || "")); } catch (_) { return e.json(404, { message: "Товар не найден" }); }

  const was = items[i].name;
  if (String(p.get("name")) === String(was)) return e.json(200, { ok: true, name: was });

  // Сумму и размер не трогаем: покупатель заплатил за свой букет, меняется только сорт
  items[i] = Object.assign({}, items[i], { id: p.id, name: p.get("name") });

  // Сначала убеждаемся, что новый сорт вообще есть в МоёмСкладе, и только потом сохраняем:
  // иначе в заказе останется сорт, который некуда списать.
  if (o.get("ms_id")) {
    const probe = msl.checkItem($app, items[i]);
    if (!probe.ok) return e.json(400, { message: probe.error || "Не нашёл этот сорт в МоёмСкладе" });
  }

  o.set("items", items);
  $app.save(o);

  const r = msl.syncPositions($app, o);
  if (!r.ok) return e.json(200, { ok: true, name: p.get("name"), warn: r.error || "В МойСклад не переписалось — проверьте вручную." });

  const s = shop.settings($app);
  shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
    text: `🔁 Заказ №${o.get("number")}: «${was}» заменили на «${p.get("name")}»` }));
  return e.json(200, { ok: true, name: p.get("name") });
}, $apis.requireAuth("managers"));
