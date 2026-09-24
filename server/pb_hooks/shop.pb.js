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
  if (!shop.autoDelivery(s)) return e.json(400, { message: "Расчёт доставки по карте выключен." });
  const b = e.requestInfo().body || {};
  const r = geo.check($app, s, {
    street: String(b.street || "").slice(0, 200),
    house: String(b.house || "").slice(0, 20),
    block: String(b.block || "").slice(0, 20),
  }, +b.sum || 0);   // сумма букетов нужна для «бесплатно от»; заказ всё равно пересчитается на сервере
  if (!r.ok) return e.json(400, { message: r.error });
  return e.json(200, { km: r.km, price: r.price, address: r.found, zone: r.zoneName });
});

// Кольца Москвы для карты в админке — обычные точки, ничего секретного
routerAdd("GET", "/api/shop/mkad", (e) => {
  const r = require(`${__hooks}/lib/rings.js`);
  e.response.header().set("Cache-Control", "public, max-age=86400");
  return e.json(200, { ring: r.MKAD, rings: r.RINGS, names: r.RING_NAMES });
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

// Покупателю — сообщение о смене статуса. Именно о смене: заказ сохраняется много раз
// (фото, оплата, МойСклад), и без этой проверки клиенту приходило одно и то же по три раза.
onRecordAfterUpdateSuccess((e) => {
  try {
    const shop = require(`${__hooks}/lib/shop.js`);
    const now = e.record.get("status");
    let was = now;
    try { was = e.record.original().get("status"); } catch (_) {}
    if (now && now !== was) shop.notifyCustomer($app, e.record, now);
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
  if (!s.get("ymaps_key") && !s.get("ymaps_suggest_key")) return e.json(400, { message: "Сначала сохраните ключ Яндекс.Карт." });
  const b = e.requestInfo().body || {};
  const r = geo.check($app, s, {
    street: String(b.street || "").slice(0, 200),
    house: String(b.house || "").slice(0, 20),
    block: String(b.block || "").slice(0, 20),
  }, +b.sum || 0);
  if (!r.ok) return e.json(400, { message: r.error });
  return e.json(200, { km: r.km, price: r.price, address: r.found, zone: r.zoneName, from: s.get("origin_address") });
}, $apis.requireAuth("managers"));

// Кнопка «Проверить» у мессенджера MAX: заодно подставляем имя бота для ссылки
routerAdd("POST", "/api/shop/max-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const mx = require(`${__hooks}/lib/max.js`);
  const s = shop.settings($app);
  const r = mx.me(s.get("max_token"));
  if (!r.ok) return e.json(400, { message: r.error });
  const d = r.data || {};
  const username = d.username || "";
  if (username && username !== s.get("max_bot")) { s.set("max_bot", username); $app.save(s); }
  return e.json(200, { name: d.name || d.first_name || "", username });
}, $apis.requireAuth("managers"));

// Кнопка «Проверить бота» в админке
// Отправить клиенту сохранённое фото ещё раз: если первая попытка не дошла,
// не нужно заново просить флориста фотографировать.
routerAdd("POST", "/api/shop/photo-resend", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const b = e.requestInfo().body || {};
  const s = shop.settings($app);

  let ord;
  try { ord = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const chat = String(b.chat || ord.get("tg_chat") || "");
  if (!chat) return e.json(400, { message: "Покупатель не подписан на бота" });

  let photo;
  try { photo = $app.findFirstRecordByFilter("order_photos", "order = {:o}", { o: ord.id }); } catch (_) {}
  if (!photo) return e.json(404, { message: "Для этого заказа фото ещё не присылали" });

  const path = `${$app.dataDir()}/storage/${photo.collection().id}/${photo.id}/${photo.get("photo")}`;
  const sent = shop.tgPhoto(shop.clientToken(s), chat, path,
    `Ваш букет по заказу №${ord.get("number")} готов.\n\nНравится?`,
    { inline_keyboard: [[{ text: "👍", callback_data: `ap:${ord.id}` }, { text: "👎", callback_data: `rw:${ord.id}` }]] });
  if (!sent || !sent.ok) return e.json(502, { message: "Телеграм не принял фото", answer: sent });
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));

// Проверка бота без телефона: подсовываем боту сообщение и смотрим, что он сделает.
// Нужна, чтобы чинить вход и подписку, не прося владельца жать кнопки.
routerAdd("POST", "/api/shop/tg-sim", (e) => {
  const bot = require(`${__hooks}/lib/bot.js`);
  const b = e.requestInfo().body || {};
  const chat = +b.chat || 0;
  if (!chat) return e.json(400, { message: "Укажите chat" });
  const upd = {
    update_id: Date.now(),
    message: {
      message_id: Date.now(),
      chat: { id: chat, type: "private" },
      from: { id: chat, first_name: String(b.name || "Проверка") },
      text: String(b.text || "/start"),
    },
  };
  try {
    bot.handleClient($app, upd);
    return e.json(200, { ok: true });
  } catch (err) {
    return e.json(500, { message: String(err) });
  }
}, $apis.requireAuth("managers"));

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
