// Единая лента переписки: сайт, клиентский бот Телеграма и MAX.
// Менеджер отвечает из админки, ответ уходит туда, откуда человек написал последний раз.
const shop = require(`${__hooks}/lib/shop.js`);

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

// Диалог покупателя: находим по нему, иначе заводим.
// Ключ браузера всё равно нужен (поле обязательное) — придумываем служебный.
function chatFor(app, cust, from, brand) {
  let chat = null;
  try { chat = app.findFirstRecordByFilter("chats", "customer = {:c}", { c: cust.id }); } catch (_) {}
  if (!chat) {
    chat = new Record(app.findCollectionByNameOrId("chats"));
    chat.set("token", `bot-${cust.id}-${$security.randomString(12)}`);
    chat.set("customer", cust.id);
  }
  // В чьём боте человек написал. Без этого ответ менеджера уходил ключом
  // venikoff в чужого бота и не доходил вовсе: у 1250 покупателей бот «Гет
  // Букета», у 122 — «ЛасФлор».
  if (brand && brand.id) chat.set("brand", brand.id);
  if (!chat.get("name")) chat.set("name", cust.get("name") || cust.get("tg_name") || cust.get("max_name") || "");
  if (!chat.get("phone")) chat.set("phone", cust.get("phone") || "");
  chat.set("last_from", from);
  return chat;
}

// Сообщение покупателя из бота — кладём в общую ленту и зовём менеджера.
// file — картинка, если прислали фото (покупатели часто показывают, а не описывают)
function fromClient(app, cust, text, from, file, brand) {
  const t = String(text || "").trim().slice(0, 2000);
  if (!t && !file) return null;
  const chat = chatFor(app, cust, from, brand);
  chat.set("last_text", (t || "📷 фото").slice(0, 300));
  chat.set("last_at", new Date().toISOString());
  chat.set("unread", (+chat.get("unread") || 0) + 1);
  chat.set("answered", false);
  app.save(chat);

  const m = new Record(app.findCollectionByNameOrId("chat_messages"));
  m.set("chat", chat.id);
  m.set("side", "client");
  m.set("text", t);
  m.set("via", from);
  if (file) m.set("photo", file);
  app.save(m);

  try {
    const s = shop.settings(app);
    const where = from === "tg" ? "Телеграм" : from === "max" ? "MAX" : "сайт";
    const who = [chat.get("name"), chat.get("phone")].filter(Boolean).join(", ") || "покупатель";
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", {
      chat_id: adm,
      text: `💬 ${where} — ${who}\n\n«${(t || "прислал фото").slice(0, 900)}»\n\nОтветьте на это сообщение [chat:${chat.id}]`,
      reply_markup: { force_reply: true },
    }));
    if (file) {
      const path = `${app.dataDir()}/storage/${m.collection().id}/${m.id}/${m.get("photo")}`;
      shop.adminIds(s).forEach((adm) => shop.tgPhoto(s.get("tg_token"), adm, path, `Фото из чата — ${who}`));
    }
    require(`${__hooks}/lib/callnow.js`).чатСигнал(app, who, t || "прислал фото", from);
  } catch (err) { console.log("chat from bot", err); }
  return chat;
}

// Каким ботом отвечать. В Телеграме номер собеседника одинаков у всех ботов,
// но написать человеку может только тот бот, который он сам запустил. Поэтому
// перебираем: витрина диалога → метки «в чьём боте писал» (customers.tg_brands,
// их ставит markBot) → общие настройки. Первый, кто принял сообщение, и верный:
// его и запоминаем у диалога, чтобы в следующий раз не перебирать.
function ботыДля(app, chat, cust, kind) {
  const поле = kind === "max" ? "max_token" : "tg_client_token";
  const метки = kind === "max" ? "max_brands" : "tg_brands";
  const out = [];
  const добавить = (t, b) => {
    const v = String(t || "");
    if (v && !out.some((x) => x.token === v)) out.push({ token: v, brand: b || null });
  };
  if (chat.get("brand")) {
    try { const b = app.findRecordById("brands", chat.get("brand")); добавить(b.get(поле), b); } catch (_) {}
  }
  // Писал в оба бота — начинаем с витрины его последнего заказа: вероятнее всего
  // человек спрашивает про него, и отвечать из чужого бота странно.
  if (cust) {
    try {
      const l = app.findRecordsByFilter("orders", "customer = {:c} && brand != ''", "-created", 1, 0, { c: cust.id });
      if (l.length) { const b = app.findRecordById("brands", l[0].get("brand")); добавить(b.get(поле), b); }
    } catch (_) {}
  }
  // метки идут в порядке первого обращения — свежие в конце, с них и начинаем
  String((cust && cust.get(метки)) || "").split(",").filter(Boolean).reverse().forEach((slug) => {
    try { const b = app.findFirstRecordByFilter("brands", "slug = {:s}", { s: slug }); добавить(b.get(поле), b); } catch (_) {}
  });
  const s = shop.settings(app);
  добавить(kind === "max" ? s.get("max_token") : (s.get("tg_client_token") || s.get("tg_token")), null);
  return out;
}

// Ответ менеджера: в ленту он уже записан, здесь доставляем его человеку.
// куда — канал, выбранный менеджером («tg», «max», «site»); не выбрал — туда,
// откуда человек написал последний раз.
function deliver(app, chat, text, photoPath, куда) {
  const from = String(куда || chat.get("last_from") || "site");
  if (from === "site") return { ok: true, where: "в чат на сайте" };
  let cust = null;
  try { cust = app.findRecordById("customers", chat.get("customer")); } catch (_) {}
  // Диалог мог не успеть привязаться к кабинету — ищем покупателя по телефону.
  if (!cust) {
    const tail = String(chat.get("phone") || "").replace(/\D/g, "").slice(-10);
    if (tail.length === 10) {
      const где = from === "max" ? "max_chat != '' && phone ~ {:t}" : "tg_chat != '' && phone ~ {:t}";
      try { cust = app.findFirstRecordByFilter("customers", где, { t: tail }); } catch (_) {}
    }
  }
  if (!cust) return { ok: false, error: "Диалог не привязан к покупателю — ответ в мессенджер не уйдёт." };
  const адрес = from === "max" ? cust.get("max_chat") : cust.get("tg_chat");
  if (!адрес) return { ok: false, error: from === "max" ? "У покупателя нет MAX." : "Покупатель не подписан на бота." };

  const боты = ботыДля(app, chat, cust, from);
  if (!боты.length) return { ok: false, error: "Бот не настроен." };
  let последняя = "не принял сообщение";
  for (const b of боты) {
    let r = null;
    if (from === "max") {
      const mx = require(`${__hooks}/lib/max.js`);
      r = photoPath ? mx.sendPhoto(b.token, адрес, photoPath, text) : mx.send(b.token, адрес, text);
    } else {
      r = photoPath ? shop.tgPhoto(b.token, адрес, photoPath, text)
                    : shop.tg(b.token, "sendMessage", { chat_id: адрес, text });
    }
    if (r && r.ok) {
      if (b.brand && chat.get("brand") !== b.brand.id) {
        // запросом, мимо хуков: обычное сохранение разбудит обработчики диалога
        try { app.db().newQuery("UPDATE chats SET brand = {:b} WHERE id = {:id}").bind({ b: b.brand.id, id: chat.id }).execute(); } catch (_) {}
      }
      return { ok: true, where: from === "max" ? "в MAX" : "в Телеграм" };
    }
    последняя = (r && (r.error || r.description)) || "не принял сообщение";
  }
  return { ok: false, error: `${from === "max" ? "MAX" : "Телеграм"} не принял ответ: ${последняя}` };
}

// Кто ответил. В поле author лежит id сотрудника (ответ из админки) либо имя
// из Телеграма (ответ реплаем в служебном боте) — показываем человеческое имя
// в обоих случаях. Кэш нужен, чтобы на двести сообщений не сходить в базу
// двести раз.
function имяАвтора(app, id, кэш) {
  const ключ = String(id || "");
  if (!ключ) return "";
  const c = кэш || {};
  if (c[ключ] !== undefined) return c[ключ];
  let имя = ключ;
  try {
    const m = app.findRecordById("managers", ключ);
    имя = m.get("name") || m.get("nick") || m.get("email") || ключ;
  } catch (_) {
    // не id, а имя из Телеграма — так и оставляем
  }
  c[ключ] = имя;
  return имя;
}

module.exports = { chatFor, fromClient, deliver, chatByToken, whoIs, findChat, ботыДля, имяАвтора };
