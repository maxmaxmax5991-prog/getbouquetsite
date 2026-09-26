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

  let chat = null;
  try { chat = $app.findFirstRecordByFilter("chats", "token = {:t}", { t: token }); } catch (_) {}
  if (!chat) {
    chat = new Record($app.findCollectionByNameOrId("chats"));
    chat.set("token", token);
  }

  // если покупатель вошёл в кабинет — видим, кто пишет, и его заказы
  try {
    const acc = require(`${__hooks}/lib/account.js`);
    const c = acc.byToken($app, e.request.header.get("X-Customer-Token"));
    if (c) {
      chat.set("customer", c.id);
      if (!chat.get("name")) chat.set("name", c.get("name") || c.get("tg_name") || "");
      if (!chat.get("phone")) chat.set("phone", c.get("phone") || "");
    }
  } catch (_) {}
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
    const who = [chat.get("name"), chat.get("phone")].filter(Boolean).join(", ") || "гость с сайта";
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
  let chat = null;
  try { chat = $app.findFirstRecordByFilter("chats", "token = {:t}", { t: token }); } catch (_) {}
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
  let orders = [];
  if (chat.get("customer")) {
    orders = $app.findRecordsByFilter("orders", "customer = {:c}", "-created", 5, 0, { c: chat.get("customer") })
      .map((o) => ({ number: o.get("number"), status: shop.STATUS[o.get("status")] || o.get("status"), total: o.get("total") }));
  }
  return e.json(200, {
    name: chat.get("name") || "", phone: chat.get("phone") || "", orders,
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
