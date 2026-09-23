/// <reference path="../pb_data/types.d.ts" />
// Оплата картой: проверка платежа после виджета и добор «висящих» оплат раз в минуту.

// Сайт зовёт сразу после успешной оплаты в виджете
routerAdd("POST", "/api/shop/pay-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const body = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(body.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const paid = pay.checkOrder($app, o) || o.get("payment_status") === "paid";
  return e.json(200, { paid, number: o.get("number") });
});

// Оплата могла пройти, а браузер закрыться — дочищаем сами
cronAdd("pay-poll", "* * * * *", () => {
  const pay = require(`${__hooks}/lib/pay.js`);
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  if (!s.get("cp_public_id") || !s.get("cp_secret")) return;
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const list = $app.findRecordsByFilter("orders", `payment_method = "card" && payment_status = "unpaid" && created > {:since}`, "-created", 50, 0, { since });
  list.forEach((o) => { try { pay.checkOrder($app, o); } catch (err) { console.log("pay-poll", err); } });
});

// Кнопка «Проверить оплату» в админке
routerAdd("POST", "/api/shop/cp-test", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const r = pay.test(shop.settings($app));
  return r.ok ? e.json(200, { ok: true }) : e.json(400, { message: r.error });
}, $apis.requireAuth("managers"));
