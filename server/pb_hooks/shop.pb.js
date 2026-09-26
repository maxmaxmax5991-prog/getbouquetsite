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
    // Заказ с оплатой картой показываем флористу только после оплаты (это сделает lib/pay.js).
    // Иначе в боте висели заказы, к оплате которых покупатель ещё даже не приступил,
    // и часть из них так и не оплачивалась.
    if (e.record.get("payment_method") !== "card") shop.notifyOrder($app, e.record);
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

// Покупателю — сообщение о смене статуса, ровно один раз.
// Заказ сохраняется много раз (фото, оплата, МойСклад), а проверки оплаты со страницы
// заказа, из корзины и из бота идут одновременно — сравнения со старым значением мало,
// три проверки в один миг видят одно и то же. Поэтому в самой записи держим отметку
// «об этом статусе уже сообщили» и ставим её сразу, до отправки.
onRecordAfterUpdateSuccess((e) => {
  try {
    const shop = require(`${__hooks}/lib/shop.js`);
    const now = String(e.record.get("status") || "");
    if (!now) { e.next(); return; }

    // Отметку держим в отдельной табличке order_notified: ключ «заказ + статус»
    // не даёт вставить её дважды. В самом заказе держать нельзя — соседние сохранения
    // (оплата, МойСклад) пишут запись целиком из прочитанной раньше копии и затирают
    // отметку, из-за чего одно и то же сообщение уходило покупателю по шесть раз.
    let send = false;
    try {
      $app.db().newQuery("INSERT INTO order_notified (order_id, status, at) VALUES ({:id}, {:s}, {:t})")
        .bind({ id: e.record.id, s: now, t: new Date().toISOString() }).execute();
      send = true;
    } catch (_) { send = false; }   // уже сообщали об этом статусе
    if (send) shop.notifyCustomer($app, e.record, now);
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
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
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
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
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
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
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
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
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
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });

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

// Остатки и «цветы в пути». Отдельный маршрут, а не правка товара напрямую:
// товары целиком может менять только владелец, а остатками ведает и управляющий.
routerAdd("POST", "/api/shop/stock-set", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Остатками управляет владелец или управляющий." });
  const b = e.requestInfo().body || {};
  let p;
  try { p = $app.findRecordById("products", String(b.product || "")); } catch (_) { return e.json(404, { message: "Товар не найден" }); }

  if (b.ready_at !== undefined) {
    const v = String(b.ready_at || "").trim();
    if (v && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return e.json(400, { message: "Время приезда: ГГГГ-ММ-ДД ЧЧ:ММ" });
    p.set("ready_at", v);
  }
  if (b.stock !== undefined && b.stock && typeof b.stock === "object") {
    const out = {};
    Object.keys(b.stock).forEach((k) => { if (/^\d+$/.test(k)) out[k] = Math.max(0, Math.round(+b.stock[k] || 0)); });
    p.set("stock", out);
  }
  if (b.site_only !== undefined) p.set("site_only", !!b.site_only);
  $app.save(p);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));

// Кто я и что мне можно — админка прячет по этому лишние вкладки
routerAdd("GET", "/api/shop/me-role", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const r = shop.role(e);
  return e.json(200, {
    role: r,
    name: (() => { try { return e.auth.get("name") || e.auth.get("email") || ""; } catch (_) { return ""; } })(),
    can: {
      orders: true, chat: true, swap: true,          // это может каждый
      stock: r === "owner" || r === "head",
      all: r === "owner",
    },
  });
}, $apis.requireAuth("managers"));

// Сотрудники: список, добавление, смена роли, удаление. Только владелец.
routerAdd("GET", "/api/shop/staff", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const list = $app.findRecordsByFilter("managers", "id != ''", "created", 100, 0);
  return e.json(200, {
    staff: list.map((m) => ({ id: m.id, nick: m.get("nick") || "", email: m.get("email") || "", name: m.get("name") || "", role: m.get("role") || "manager", me: m.id === e.auth.id })),
  });
}, $apis.requireAuth("managers"));

routerAdd("POST", "/api/shop/staff", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const b = e.requestInfo().body || {};
  const nick = String(b.nick || "").trim().toLowerCase();
  const email = String(b.email || "").trim().toLowerCase();
  const pass = String(b.password || "");
  const rl = ["owner", "head", "manager"].indexOf(String(b.role || "")) >= 0 ? String(b.role) : "manager";
  if (!/^[a-z0-9_.-]{3,40}$/.test(nick)) return e.json(400, { message: "Логин: латиница, цифры, точка и дефис, от 3 знаков." });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return e.json(400, { message: "Проверьте почту." });
  if (pass.length < 8) return e.json(400, { message: "Пароль — не короче 8 знаков." });
  try { $app.findFirstRecordByFilter("managers", "nick = {:n}", { n: nick }); return e.json(400, { message: "Такой логин уже занят." }); } catch (_) {}

  const rec = new Record($app.findCollectionByNameOrId("managers"));
  rec.set("nick", nick);
  if (email) rec.set("email", email);
  rec.set("name", String(b.name || "").slice(0, 120));
  rec.set("role", rl);
  rec.set("password", pass);
  rec.set("passwordConfirm", pass);
  rec.set("verified", true);
  $app.save(rec);
  return e.json(200, { ok: true, id: rec.id });
}, $apis.requireAuth("managers"));

routerAdd("POST", "/api/shop/staff-edit", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const b = e.requestInfo().body || {};
  let m;
  try { m = $app.findRecordById("managers", String(b.id || "")); } catch (_) { return e.json(404, { message: "Сотрудник не найден" }); }

  if (b.remove) {
    if (m.id === e.auth.id) return e.json(400, { message: "Себя удалить нельзя." });
    $app.delete(m);
    return e.json(200, { ok: true });
  }
  if (b.role) {
    const rl = ["owner", "head", "manager"].indexOf(String(b.role)) >= 0 ? String(b.role) : "";
    if (!rl) return e.json(400, { message: "Неизвестная роль" });
    // нельзя снять с себя права владельца, если владелец один — иначе некому будет управлять
    if (m.id === e.auth.id && rl !== "owner") {
      const owners = $app.findRecordsByFilter("managers", "role = 'owner'", "", 5, 0);
      if (owners.length < 2) return e.json(400, { message: "Вы единственный владелец — сначала назначьте второго." });
    }
    m.set("role", rl);
  }
  if (b.password) {
    if (String(b.password).length < 8) return e.json(400, { message: "Пароль — не короче 8 знаков." });
    m.set("password", String(b.password));
    m.set("passwordConfirm", String(b.password));
  }
  if (b.name !== undefined) m.set("name", String(b.name).slice(0, 120));
  if (b.nick) {
    const nick = String(b.nick).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,40}$/.test(nick)) return e.json(400, { message: "Логин: латиница, цифры, точка и дефис, от 3 знаков." });
    try { const other = $app.findFirstRecordByFilter("managers", "nick = {:n}", { n: nick }); if (other.id !== m.id) return e.json(400, { message: "Такой логин уже занят." }); } catch (_) {}
    m.set("nick", nick);
  }
  $app.save(m);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
