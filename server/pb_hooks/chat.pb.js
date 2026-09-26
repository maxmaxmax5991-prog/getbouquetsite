// Диалог по ключу браузера: ключей может быть несколько, если диалоги склеивали
function chatByToken(app, token) {
  try { return app.findFirstRecordByFilter("chats", "token = {:t}", { t: token }); } catch (_) {}
  try { return app.findFirstRecordByFilter("chats", "alt ~ {:t}", { t: token }); } catch (_) {}
  return null;
}

// Кто пишет: вошедший покупатель, если он вошёл
function whoIs(app, e) {
  try {
    const acc = require(`${__hooks}/lib/account.js`);
    return acc.byToken(app, e.request.header.get("X-Customer-Token"));
  } catch (_) { return null; }
}

// Находим диалог так, чтобы переписка не терялась при смене браузера или телефона:
// вошёл в кабинет — ищем по покупателю, иначе по ключу из его браузера.
// Нашли по покупателю, а ключ новый — запоминаем ключ, чтобы и без входа находилось.
function findChat(app, token, cust) {
  let chat = null;
  if (cust) {
    try { chat = app.findFirstRecordByFilter("chats", "customer = {:c}", { c: cust.id }); } catch (_) {}
  }
  if (!chat) return chatByToken(app, token);
  if (token && chat.get("token") !== token && String(chat.get("alt") || "").indexOf(token) < 0) {
    const alts = String(chat.get("alt") || "").split(",").filter(Boolean);
    alts.push(token);
    chat.set("alt", alts.slice(-20).join(","));
    app.save(chat);
  }
  return chat;
}

/// <reference path="../pb_data/types.d.ts" />
// Чат на сайте. Переписка живёт у нас; отвечаем из админки или реплаем в служебном боте.
// Посетителя узнаём по случайному ключу из его браузера — входить в кабинет не обязательно.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное пишем внутри.

// Покупатель пишет
routerAdd("POST", "/api/shop/chat/send", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const b = e.requestInfo().body || {};
  const token = String(b.token || "").trim();
  const text = String(b.text || "").trim().slice(0, 2000);
  if (token.length < 16 || token.length > 64) return e.json(400, { message: "Обновите страницу." });
  if (!text) return e.json(400, { message: "Напишите сообщение." });

  // не даём завалить нас сообщениями с одной вкладки
  const recent = $app.findRecordsByFilter("chat_messages",
    `side = "client" && created > {:t}`, "-created", 30, 0,
    { t: new Date(Date.now() - 60000).toISOString().replace("T", " ").slice(0, 19) });
  if (recent.length > 20) return e.json(429, { message: "Слишком много сообщений. Подождите минуту." });

  const me = whoIs($app, e);
  let chat = findChat($app, token, me);
  if (!chat) {
    chat = new Record($app.findCollectionByNameOrId("chats"));
    chat.set("token", token);
  }

  // вошёл в кабинет — видим, кто пишет, и его заказы
  if (me) {
    chat.set("customer", me.id);
    if (!chat.get("name")) chat.set("name", me.get("name") || me.get("tg_name") || "");
    if (!chat.get("phone")) chat.set("phone", me.get("phone") || "");
  }
  // заказывал без входа — узнаём по коду последнего заказа из его браузера
  if (b.order) {
    let o = null;
    try { o = $app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: String(b.order) }); } catch (_) {}
    if (o) {
      if (!chat.get("name")) chat.set("name", o.get("name") || "");
      if (!chat.get("phone")) chat.set("phone", o.get("phone") || "");
      if (!chat.get("customer") && o.get("customer")) chat.set("customer", o.get("customer"));
    }
  }
  if (b.name && !chat.get("name")) chat.set("name", String(b.name).slice(0, 120));
  if (b.phone && !chat.get("phone")) chat.set("phone", String(b.phone).slice(0, 40));

  chat.set("last_text", text.slice(0, 300));
  chat.set("last_at", new Date().toISOString());
  chat.set("unread", (+chat.get("unread") || 0) + 1);
  chat.set("answered", false);
  chat.set("closed", false);
  $app.save(chat);

  const m = new Record($app.findCollectionByNameOrId("chat_messages"));
  m.set("chat", chat.id);
  m.set("side", "client");
  m.set("text", text);
  $app.save(m);

  // дублируем в служебный бот: ответить можно прямо оттуда, реплаем
  try {
    const s = shop.settings($app);
    let who = [chat.get("name"), chat.get("phone")].filter(Boolean).join(", ") || "гость с сайта";
    try {
      const tail = String(chat.get("phone") || "").replace(/\D/g, "").slice(-10);
      if (tail.length === 10) {
        const last = $app.findRecordsByFilter("orders", "phone ~ {:t}", "-created", 1, 0, { t: tail });
        if (last.length) who += ` · заказ №${last[0].get("number")} (${shop.STATUS[last[0].get("status")] || last[0].get("status")})`;
      }
    } catch (_) {}
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", {
      chat_id: adm,
      text: `💬 Чат на сайте — ${who}\n\n«${text.slice(0, 900)}»\n\nОтветьте на это сообщение [chat:${chat.id}]`,
      reply_markup: { force_reply: true },
    }));
  } catch (err) { console.log("chat tg", err); }

  return e.json(200, { ok: true });
});

// Покупатель читает переписку
routerAdd("GET", "/api/shop/chat", (e) => {
  const token = String(e.request.url.query().get("token") || "").trim();
  if (token.length < 16) return e.json(200, { messages: [] });
  const chat = findChat($app, token, whoIs($app, e));
  if (!chat) return e.json(200, { messages: [] });
  const list = $app.findRecordsByFilter("chat_messages", "chat = {:c}", "created", 100, 0, { c: chat.id });
  return e.json(200, {
    messages: list.map((m) => ({ side: m.get("side"), text: m.get("text"), at: m.getString("created") })),
  });
});

// Админка: список диалогов
routerAdd("GET", "/api/shop/chats", (e) => {
  const list = $app.findRecordsByFilter("chats", "id != ''", "-last_at", 100, 0);
  return e.json(200, {
    chats: list.map((c) => ({
      id: c.id, name: c.get("name") || "", phone: c.get("phone") || "",
      last_text: c.get("last_text") || "", last_at: c.get("last_at") || "",
      unread: +c.get("unread") || 0, answered: !!c.get("answered"), customer: c.get("customer") || "",
      order: (() => {
        try {
          const tail = String(c.get("phone") || "").replace(/\D/g, "").slice(-10);
          if (tail.length !== 10) return "";
          const l = $app.findRecordsByFilter("orders", "phone ~ {:t}", "-created", 1, 0, { t: tail });
          return l.length ? String(l[0].get("number")) : "";
        } catch (_) { return ""; }
      })(),
    })),
  });
}, $apis.requireAuth("managers"));

// Админка: переписка одного диалога (и заказы этого покупателя)
routerAdd("GET", "/api/shop/chat-one", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const id = String(e.request.url.query().get("chat") || "");
  let chat;
  try { chat = $app.findRecordById("chats", id); } catch (_) { return e.json(404, { message: "Диалог не найден" }); }
  chat.set("unread", 0);
  $app.save(chat);
  const list = $app.findRecordsByFilter("chat_messages", "chat = {:c}", "created", 200, 0, { c: chat.id });
  // Заказы ищем и по связи с кабинетом, и по телефону: покупатель мог заказать без входа.
  // Телефоны сравниваем по последним десяти цифрам — записывают их кто как.
  const seen = {}, orders = [];
  const add = (o) => {
    if (seen[o.id]) return;
    seen[o.id] = 1;
    orders.push({ number: o.get("number"), status: shop.STATUS[o.get("status")] || o.get("status"), total: o.get("total"), code: o.get("tg_code") });
  };
  try {
    if (chat.get("customer")) {
      $app.findRecordsByFilter("orders", "customer = {:c}", "-created", 5, 0, { c: chat.get("customer") }).forEach(add);
    }
  } catch (_) {}
  try {
    const tail = String(chat.get("phone") || "").replace(/\D/g, "").slice(-10);
    if (tail.length === 10) {
      $app.findRecordsByFilter("orders", "phone ~ {:t}", "-created", 5, 0, { t: tail }).forEach(add);
    }
  } catch (_) {}
  orders.sort((a, b2) => b2.number - a.number);
  return e.json(200, {
    name: chat.get("name") || "", phone: chat.get("phone") || "", orders, customer: chat.get("customer") || "",
    messages: list.map((m) => ({ side: m.get("side"), text: m.get("text"), at: m.getString("created"), author: m.get("author") || "" })),
  });
}, $apis.requireAuth("managers"));

// Админка: ответить
routerAdd("POST", "/api/shop/chat-reply", (e) => {
  const b = e.requestInfo().body || {};
  const text = String(b.text || "").trim().slice(0, 2000);
  if (!text) return e.json(400, { message: "Пустой ответ" });
  let chat;
  try { chat = $app.findRecordById("chats", String(b.chat || "")); } catch (_) { return e.json(404, { message: "Диалог не найден" }); }

  const m = new Record($app.findCollectionByNameOrId("chat_messages"));
  m.set("chat", chat.id);
  m.set("side", "shop");
  m.set("text", text);
  m.set("author", String(b.author || "").slice(0, 120));
  $app.save(m);

  chat.set("last_text", text.slice(0, 300));
  chat.set("last_at", new Date().toISOString());
  chat.set("answered", true);
  chat.set("unread", 0);
  $app.save(chat);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));

// Человек написал до входа, потом вошёл (или оформил заказ) — привязываем диалог к нему.
// Если у покупателя уже был диалог с другого устройства, склеиваем: переписка одна.
routerAdd("POST", "/api/shop/chat/link", (e) => {
  const b = e.requestInfo().body || {};
  const token = String(b.token || "").trim();
  if (token.length < 16) return e.json(200, { ok: true });
  const chat = findChat($app, token, whoIs($app, e));
  if (!chat) return e.json(200, { ok: true });

  let cust = whoIs($app, e);
  // заказ без входа: имя и телефон берём из него
  if (b.order) {
    let o = null;
    try { o = $app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: String(b.order) }); } catch (_) {}
    if (o) {
      if (!chat.get("name")) chat.set("name", o.get("name") || "");
      if (!chat.get("phone")) chat.set("phone", o.get("phone") || "");
      if (!cust && o.get("customer")) { try { cust = $app.findRecordById("customers", o.get("customer")); } catch (_) {} }
    }
  }
  if (!cust) { $app.save(chat); return e.json(200, { ok: true }); }

  chat.set("customer", cust.id);
  if (!chat.get("name")) chat.set("name", cust.get("name") || cust.get("tg_name") || "");
  if (!chat.get("phone")) chat.set("phone", cust.get("phone") || "");

  // был ли у него диалог раньше — тогда переносим сообщения туда, где переписка длиннее
  let old = null;
  try {
    old = $app.findFirstRecordByFilter("chats", "customer = {:c} && id != {:id}", { c: cust.id, id: chat.id });
  } catch (_) {}
  if (!old) { $app.save(chat); return e.json(200, { ok: true }); }

  $app.findRecordsByFilter("chat_messages", "chat = {:c}", "created", 500, 0, { c: chat.id })
    .forEach((m) => { m.set("chat", old.id); $app.save(m); });
  const alts = String(old.get("alt") || "").split(",").filter(Boolean);
  if (alts.indexOf(chat.get("token")) < 0) alts.push(chat.get("token"));
  String(chat.get("alt") || "").split(",").filter(Boolean).forEach((t) => { if (alts.indexOf(t) < 0) alts.push(t); });
  old.set("alt", alts.slice(0, 20).join(","));
  if (!old.get("name")) old.set("name", chat.get("name") || "");
  if (!old.get("phone")) old.set("phone", chat.get("phone") || "");
  if (chat.get("last_at") > String(old.get("last_at") || "")) {
    old.set("last_at", chat.get("last_at"));
    old.set("last_text", chat.get("last_text"));
    old.set("answered", chat.get("answered"));
  }
  old.set("unread", (+old.get("unread") || 0) + (+chat.get("unread") || 0));
  $app.save(old);
  $app.delete(chat);
  return e.json(200, { ok: true, merged: true });
});
