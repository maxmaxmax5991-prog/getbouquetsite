/// <reference path="../pb_data/types.d.ts" />
// API магазина venikoff.net

// Весь каталог и настройки доставки одним запросом — для сайта
routerAdd("GET", "/api/shop/catalog", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  e.response.header().set("Cache-Control", "public, max-age=30");
  return e.json(200, shop.catalog($app));
});

// Подсказки адреса при вводе. Ключ Яндекса остаётся на сервере — сайт спрашивает нас.
routerAdd("GET", "/api/shop/suggest", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const geo = require(`${__hooks}/lib/geo.js`);
  const q = String(e.request.url.query().get("q") || "").trim();
  if (q.length < 3) return e.json(200, { items: [] });
  return e.json(200, { items: geo.suggest(shop.settings($app), q.slice(0, 120)) });
});

// Проверка адреса и стоимость доставки — показать покупателю до оформления.
// Это только подсказка: при создании заказа всё считается заново (prepareOrder).
routerAdd("POST", "/api/shop/address", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const geo = require(`${__hooks}/lib/geo.js`);
  const s = shop.settings($app);
  if (!s.get("km_mode")) return e.json(400, { message: "Расчёт по километрам выключен." });
  const b = e.requestInfo().body || {};
  const r = geo.check($app, s, {
    street: String(b.street || "").slice(0, 200),
    house: String(b.house || "").slice(0, 20),
    block: String(b.block || "").slice(0, 20),
  });
  if (!r.ok) return e.json(400, { message: r.error });
  return e.json(200, { km: r.km, price: r.price, address: r.found });
});

// Заказ с сайта: пересчитываем цены, доставку и проверяем дату/интервал на сервере
onRecordCreateRequest((e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  shop.prepareOrder($app, e.record);
  e.next();
}, "orders");

onRecordAfterCreateSuccess((e) => {
  try {
    const shop = require(`${__hooks}/lib/shop.js`);
    shop.notifyOrder($app, e.record);
  } catch (err) {
    console.log("notify error", err);
  }
  try {
    // сразу отправляем в МойСклад; если не вышло — заказ подхватит очередь (раз в минуту)
    const msl = require(`${__hooks}/lib/ms.js`);
    const r = msl.pushOrder($app, e.record);
    if (!r.ok && !r.wait && r.error !== "Интеграция выключена.") { e.record.set("ms_error", r.error); $app.save(e.record); }
  } catch (err) {
    console.log("ms push error", err);
  }
  e.next();
}, "orders");

// Покупателю — сообщение о смене статуса
onRecordAfterUpdateSuccess((e) => {
  try {
    const shop = require(`${__hooks}/lib/shop.js`);
    shop.notifyCustomer($app, e.record, e.record.get("status"));
  } catch (err) { console.log("customer notify", err); }
  e.next();
}, "orders");

// Телеграм: входящие сообщения бота. Всегда отвечаем 200, иначе Телеграм будет повторять запрос.
routerAdd("POST", "/api/tg/{secret}", (e) => {
  try {
    const bot = require(`${__hooks}/lib/bot.js`);
    bot.handle($app, e.request.pathValue("secret"), e.requestInfo().body);
  } catch (err) {
    console.log("bot error", err);
  }
  return e.json(200, { ok: true });
});

// После сохранения настроек — подключаем бота к сайту.
// Важно: только когда ключ бота поменялся. Настройки сохраняются часто (опрос Телеграма пишет
// в них позицию), а сам setup тоже сохраняет настройки — без этой проверки получался бесконечный
// круг и сотни обращений к Телеграму, из-за которых бот замолкал.
onRecordAfterUpdateSuccess((e) => {
  try {
    const bot = require(`${__hooks}/lib/bot.js`);
    const token = e.record.get("tg_token");
    let was = "";
    try { was = e.record.original().get("tg_token") || ""; } catch (_) {}
    if (token && (token !== was || !e.record.get("tg_bot"))) bot.setup($app, e.record);
  } catch (err) {
    console.log("bot setup error", err);
  }
  e.next();
}, "settings");

// Кнопка «Проверить адрес» в админке: работает и когда расчёт по километрам ещё выключен
routerAdd("POST", "/api/shop/geo-test", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const geo = require(`${__hooks}/lib/geo.js`);
  const s = shop.settings($app);
  if (!s.get("ymaps_key")) return e.json(400, { message: "Сначала сохраните ключ Яндекс.Карт." });
  const b = e.requestInfo().body || {};
  const r = geo.check($app, s, {
    street: String(b.street || "").slice(0, 200),
    house: String(b.house || "").slice(0, 20),
    block: String(b.block || "").slice(0, 20),
  });
  if (!r.ok) return e.json(400, { message: r.error });
  return e.json(200, { km: r.km, price: r.price, address: r.found, from: s.get("origin_address") });
}, $apis.requireAuth("managers"));

// Кнопка «Проверить бота» в админке
routerAdd("POST", "/api/shop/tg-test", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);
  const s = shop.settings($app);
  const me = shop.tg(s.get("tg_token"), "getMe", {});
  if (!me || !me.ok) return e.json(400, { message: "Ключ бота не подходит. Скопируйте его из @BotFather ещё раз." });
  const hook = bot.setup($app, s);
  const admins = shop.adminIds(s);
  admins.forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat, text: "Бот подключён к сайту venikoff.net ✅ Напишите «Меню»." }));
  return e.json(200, { bot: me.result.username, webhook: !!(hook && hook.ok), admins: admins.length });
}, $apis.requireAuth("managers"));
