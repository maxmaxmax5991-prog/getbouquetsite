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

// Состояние заказа по его коду — единственный источник правды для покупателя.
// Страница заказа на сайте только показывает то, что ответил сервер: не память браузера,
// не обработчики окна оплаты и не кнопка «Вернуться в магазин» у банка.
// Код (tg_code) случайный и в адресе не угадывается; отдаём только то, что покупатель и так знает.
routerAdd("GET", "/api/shop/order/{code}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const code = String(e.request.pathValue("code") || "");
  if (code.length < 6) return e.json(404, { message: "Заказ не найден" });
  let o;
  try { o = $app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: code }); }
  catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  // если ждём оплату — заодно спрашиваем банк прямо сейчас, не дожидаясь ежеминутной проверки
  if (o.get("payment_method") === "card" && o.get("payment_status") === "unpaid") {
    try { pay.checkOrder($app, o); } catch (err) { console.log("order check", err); }
  }
  const s = shop.settings($app);
  return e.json(200, {
    number: o.get("number"),
    total: o.get("total"),
    status: o.get("status"),
    status_text: shop.STATUS[o.get("status")] || o.get("status"),
    payment_method: o.get("payment_method"),
    payment_status: o.get("payment_status"),
    paid: o.get("payment_status") === "paid",
    delivery_type: o.get("delivery_type"),
    when: shop.whenText(o),
    address: o.get("address"),
    bot: s.get("tg_client_bot") || s.get("tg_bot") || "",
    max_bot: s.get("max_token") ? (s.get("max_bot") || "") : "",
    code,
  });
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
