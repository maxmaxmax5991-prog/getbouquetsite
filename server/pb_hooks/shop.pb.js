/// <reference path="../pb_data/types.d.ts" />
// API магазина venikoff.net

// Весь каталог и настройки доставки одним запросом — для сайта
routerAdd("GET", "/api/shop/catalog", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  e.response.header().set("Cache-Control", "public, max-age=30");
  return e.json(200, shop.catalog($app));
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

// После сохранения настроек — подключаем бота к сайту
onRecordAfterUpdateSuccess((e) => {
  try {
    const bot = require(`${__hooks}/lib/bot.js`);
    if (e.record.get("tg_token")) bot.setup($app, e.record);
  } catch (err) {
    console.log("bot setup error", err);
  }
  e.next();
}, "settings");

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
