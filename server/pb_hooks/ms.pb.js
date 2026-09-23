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
      if (!r.ok && o.get("ms_error") !== r.error) { o.set("ms_error", r.error); $app.save(o); }
    } catch (err) { console.log("ms-push", err); }
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
  return e.json(200, { ok: true, ms_id: r.id });
}, $apis.requireAuth("managers"));
