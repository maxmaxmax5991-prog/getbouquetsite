/// <reference path="../pb_data/types.d.ts" />
// API магазина venikoff.net

// Весь каталог и настройки доставки одним запросом — для сайта
routerAdd("GET", "/api/shop/catalog", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const brand = require(`${__hooks}/lib/brand.js`).byHost($app, e);
  e.response.header().set("Cache-Control", "public, max-age=30");
  return e.json(200, shop.catalog($app, brand));
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
  // с какой витрины заказ — решает домен, а не то, что прислал браузер
  try {
    const b = require(`${__hooks}/lib/brand.js`).byHost($app, e);
    e.record.set("brand", b ? b.id : "");
  } catch (err) { console.log("brand on order", err); }
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
    if (send) {
      // когда заказ пришёл в этот статус — для сроков и опозданий в статистике
      try {
        let st = {};
        try { st = JSON.parse(e.record.getString("stamps") || "{}") || {}; } catch (_) {}
        if (!st[now]) {
          st[now] = new Date().toISOString();
          $app.db().newQuery("UPDATE orders SET stamps = {:v} WHERE id = {:id}")
            .bind({ v: JSON.stringify(st), id: e.record.id }).execute();
        }
      } catch (err) { console.log("отметка статуса", err); }
      shop.notifyCustomer($app, e.record, now);
      // вручили — просим оценить: оформление, букет, доставку
      if (now === "done") {
        try { require(`${__hooks}/lib/review.js`).start($app, e.record); }
        catch (err) { console.log("опрос", err); require(`${__hooks}/lib/err.js`).note($app, "Опрос", String(err), "запуск после вручения"); }
      }
    }
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

// Проверка бота витрины: подошёл ли ключ, и заодно запоминаем имя бота для ссылок.
routerAdd("POST", "/api/shop/brand-bot-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner"])) return e.json(403, { message: "Ботами управляет владелец." });
  const b = e.requestInfo().body || {};
  let br;
  try { br = $app.findRecordById("brands", String(b.brand || "")); } catch (_) { return e.json(404, { message: "Витрина не найдена" }); }

  if (String(b.kind) === "cp") {
    const pay = require(`${__hooks}/lib/pay.js`);
    const r = pay.test(shop.settings($app), br);
    if (!r.ok) return e.json(400, { message: r.error });
    const k = pay.keysOf(shop.settings($app), br);
    return e.json(200, { bot: "терминал " + String(k.id).slice(0, 10) + "…" });
  }

  if (String(b.kind) === "max") {
    const mx = require(`${__hooks}/lib/max.js`);
    const token = br.get("max_token");
    if (!token) return e.json(400, { message: "Ключ бота MAX не указан" });
    const r = mx.me(token);
    if (!r.ok) return e.json(400, { message: r.error });
    const name = (r.data && (r.data.username || r.data.name || r.data.first_name)) || "";
    if (r.data && r.data.username) { br.set("max_bot", r.data.username); $app.save(br); }
    return e.json(200, { bot: name });
  }

  const token = br.get("tg_client_token");
  if (!token) return e.json(400, { message: "Ключ бота Телеграма не указан" });
  const me = shop.tg(token, "getMe", {});
  if (!me || !me.ok) return e.json(400, { message: "Ключ не подошёл. Скопируйте его из @BotFather ещё раз." });
  // webhook убираем: сообщения мы забираем опросом, иначе Телеграм отвечает 409
  shop.tg(token, "deleteWebhook", { drop_pending_updates: false });
  br.set("tg_client_bot", me.result.username);
  $app.save(br);
  return e.json(200, { bot: me.result.username });
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
  const token = s.get("tg_token");
  // Проверяем каждого поимённо. Телеграм не даёт боту написать первым: пока человек
  // сам не нажал «Старт», сообщения ему молча не доходят, и владелец об этом
  // никак не узнавал — просто «сотрудник не получает уведомления».
  const who = (chat) => {
    const c = shop.tg(token, "getChat", { chat_id: chat });
    if (!c || !c.ok || !c.result) return "";
    const r = c.result;
    return [r.first_name, r.last_name].filter(Boolean).join(" ") + (r.username ? ` (@${r.username})` : "");
  };
  const human = (d) => {
    const t = String(d || "").toLowerCase();
    if (t.indexOf("blocked") >= 0) return "заблокировал бота";
    if (t.indexOf("chat not found") >= 0 || t.indexOf("initiate conversation") >= 0) return "не открывал бота — пусть нажмёт «Старт»";
    if (t.indexOf("deactivated") >= 0) return "аккаунт удалён";
    return d || "не дошло";
  };
  const check = (chat, role, text) => {
    const r = shop.tg(token, "sendMessage", { chat_id: chat, text });
    return { id: chat, role, name: who(chat), ok: !!(r && r.ok), error: (r && r.ok) ? "" : human(r && r.description) };
  };
  const rows = shop.bossIds(s).map((c) => check(c, "Полное управление", "Бот подключён к сайту venikoff.net ✅ Напишите «Меню»."))
    .concat(shop.watcherIds(s).map((c) => check(c, "Только уведомления", "Проверка связи ✅ Сюда будут приходить заказы, оплаты и сообщения покупателей.")))
    .concat(shop.floristIds(s).map((c) => check(c, "Только фото букетов", "Проверка связи ✅ Сюда будут приходить карточки заказов — присылайте фото готовых букетов ответом на них.")));
  return e.json(200, { bot: me.result.username, webhook: !!(hook && hook.ok), admins: shop.adminIds(s).length, rows });
}, $apis.requireAuth("managers"));

// «Высокая нагрузка»: прибавить минут на сборку всем заказам разом.
// Отдельный маршрут, а не правка настроек целиком: настройки может менять только
// владелец, а в запару режим включает тот, кто стоит за столом.
routerAdd("POST", "/api/shop/load", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Это может владелец или управляющий." });
  const b = e.requestInfo().body || {};
  const clamp = (v) => Math.max(0, Math.min(600, Math.round(+v || 0)));
  const mins = clamp(b.minutes);
  // у самовывоза прибавка своя; не прислали — ставим ту же
  const pick = b.pickup === undefined || b.pickup === null ? mins : clamp(b.pickup);
  const s = shop.settings($app);
  s.set("load_extra", mins);
  s.set("load_extra_pickup", pick);
  // До конца рабочего дня по Москве: забытый на ночь режим не должен портить утро.
  // Рабочий день уже кончился — держим три часа, чтобы дозакрыть вечер.
  let until = "";
  if (mins > 0 || pick > 0) {
    const now = new Date(Date.now() + 3 * 3600e3);                       // «сейчас» по Москве
    const [hh, mm] = String(s.get("delivery_to") || s.get("work_to") || "23:00").split(":");
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), +hh || 23, +mm || 0) - 3 * 3600e3;
    until = new Date(end > Date.now() ? end : Date.now() + 3 * 3600e3).toISOString();
  }
  s.set("load_until", until);
  $app.save(s);
  const who = String(b.by || "").slice(0, 60);
  shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
    text: (mins > 0 || pick > 0)
      ? `🔥 Высокая нагрузка${who ? " — включил(а) " + who : ""}:\nдоставка +${mins} мин, самовывоз +${pick} мин.\nСайт сдвинул ближайшие интервалы. Само выключится в ${new Date(Date.parse(until) + 3 * 3600e3).toISOString().slice(11, 16)} по Москве.`
      : `✅ Обычный режим${who ? " — вернул(а) " + who : ""}.` }));
  return e.json(200, { minutes: mins, pickup: pick, until });
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
  // Привоз: по каждой длине сколько едет и когда будет.
  if (b.incoming !== undefined && b.incoming && typeof b.incoming === "object") {
    const out = {};
    Object.keys(b.incoming).forEach((k) => {
      if (!/^\d+$/.test(k)) return;
      const row = b.incoming[k] || {};
      const qty = Math.max(0, Math.round(+row.qty || 0));
      const at = String(row.at || "").trim();
      if (!qty) return;                       // ноль — значит строки нет
      if (at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) return;
      out[k] = { qty, at };
    });
    p.set("incoming", out);
  }
  // «Привезли»: всё, что ехало, прибавляем к остатку и очищаем привоз.
  if (b.arrived) {
    const st = shop.stockOf(p), inc = shop.incomingOf(p);
    Object.keys(inc).forEach((k) => {
      const q = +((inc[k] || {}).qty) || 0;
      if (q > 0) st[k] = Math.max(0, (+st[k] || 0) + q);
    });
    p.set("stock", st);
    p.set("incoming", {});
    p.set("ready_at", "");
    p.set("fresh_date", shop.moscowToday());   // приехало сегодня — так и помечаем
  }
  if (b.site_only !== undefined) p.set("site_only", !!b.site_only);
  if (b.fresh !== undefined) p.set("fresh_date", b.fresh ? shop.moscowToday() : "");
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
      // оценку правит только владелец: это не исправление опечатки,
      // а изменение того, что сказал покупатель
      fixnps: r === "owner",
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

// Поиск номенклатуры в МоёмСкладе — для ручной привязки товара
routerAdd("GET", "/api/shop/ms-search", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const msl = require(`${__hooks}/lib/ms.js`);
  const s = shop.settings($app);
  const q = String(e.request.url.query().get("q") || "").trim();
  if (q.length < 2) return e.json(200, { items: [] });
  // Ищем по всему ассортименту, а не только по товарам: сорт может быть заведён
  // услугой, модификацией или комплектом, и тогда поиск по /entity/product
  // не находил его вовсе — выглядело как «в складе нет такой номенклатуры».
  // У ассортимента search не работает так, как у товаров: он возвращает всё
  // подряд. Отбираем по вхождению в название.
  const r = msl.ms(s, "GET", `/entity/assortment?limit=50&filter=${encodeURIComponent("name~" + q)}`);
  if (!r.ok) return e.json(400, { message: r.error || "МойСклад не ответил" });
  return e.json(200, { items: (r.data.rows || []).map((x) => ({
    id: x.id, name: x.name,
    тип: (x.meta && x.meta.type) || "product",
    архив: !!x.archived,
  })) });
}, $apis.requireAuth("managers"));


// «Приехало сегодня с теплицы» сразу для всего, что в наличии
routerAdd("POST", "/api/shop/fresh-all", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const on = !!b.on;
  const day = on ? shop.moscowToday() : "";
  // Завоз каждый раз разный: отмечаем только выбранные разделы. Пустой список —
  // как раньше, все сразу; так старая кнопка «всё приехало» продолжает работать.
  const cats = Array.isArray(b.cats) ? b.cats.map((x) => String(x)).filter((x) => /^[a-z0-9]+$/i.test(x)) : [];
  let n = 0;
  try {
    const where = cats.length
      ? `category IN (${cats.map((c) => `'${c}'`).join(",")})`
      : `category IN (SELECT id FROM categories WHERE addon IS NOT TRUE)`;
    const r = $app.db().newQuery(`UPDATE products SET fresh_date = {:d} WHERE active = true AND ${where}`)
      .bind({ d: day }).execute();
    n = r.rowsAffected ? r.rowsAffected() : 0;
  } catch (err) { return e.json(400, { message: String(err) }); }
  return e.json(200, { ok: true, count: n });
}, $apis.requireAuth("managers"));

// Проверка корзины до оформления. Покупатель набирает букеты, уходит пить чай,
// а за это время остаток кончился — и он узнавал об этом только по кнопке
// «Подтвердить заказ», после того как заполнил имя, адрес и время. Четыре таких
// отказа подряд 04.10 съели лимит запросов, и пятая попытка получила 429.
// Теперь корзина спрашивает остатки сразу при открытии: правим до формы.
routerAdd("POST", "/api/shop/cart-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const b = e.requestInfo().body || {};
  const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
  const out = [];
  items.forEach((it) => {
    const key = String(it.key || "");
    let p;
    try { p = $app.findRecordById("products", String(it.id || "")); } catch (_) { out.push({ key, gone: true, text: "Этого букета больше нет." }); return; }
    if (!p.get("active")) { out.push({ key, gone: true, text: "Сейчас недоступен." }); return; }
    const qty = Math.max(1, Math.floor(+it.qty || 1));
    const label = String(it.label || "");
    const m = label.match(/^(\d+)-(\d+)$/);
    if (!m) { out.push({ key, ok: true }); return; }
    const нужно = +m[2] * qty;
    if (shop.stockOk(p, m[1], нужно)) { out.push({ key, ok: true }); return; }
    const есть = Math.max(0, +shop.stockOf(p)[m[1]] || 0);
    // сколько таких букетов ещё можно собрать из того, что лежит
    const влезет = Math.floor(есть / +m[2]);
    out.push({ key, ok: false, have: есть, fit: влезет,
      text: влезет ? `Осталось ${есть} шт — хватит на ${влезет} ${влезет === 1 ? "букет" : "букета"}.` : `Закончились: осталось ${есть} шт.` });
  });
  return e.json(200, { items: out });
});
