// Единая лента переписки: сайт, клиентский бот Телеграма и MAX.
// Менеджер отвечает из админки, ответ уходит туда, откуда человек написал последний раз.
const shop = require(`${__hooks}/lib/shop.js`);

// Диалог покупателя: находим по нему, иначе заводим.
// Ключ браузера всё равно нужен (поле обязательное) — придумываем служебный.
function chatFor(app, cust, from) {
  let chat = null;
  try { chat = app.findFirstRecordByFilter("chats", "customer = {:c}", { c: cust.id }); } catch (_) {}
  if (!chat) {
    chat = new Record(app.findCollectionByNameOrId("chats"));
    chat.set("token", `bot-${cust.id}-${$security.randomString(12)}`);
    chat.set("customer", cust.id);
  }
  if (!chat.get("name")) chat.set("name", cust.get("name") || cust.get("tg_name") || cust.get("max_name") || "");
  if (!chat.get("phone")) chat.set("phone", cust.get("phone") || "");
  chat.set("last_from", from);
  return chat;
}

// Сообщение покупателя из бота — кладём в общую ленту и зовём менеджера
function fromClient(app, cust, text, from) {
  const t = String(text || "").trim().slice(0, 2000);
  if (!t) return null;
  const chat = chatFor(app, cust, from);
  chat.set("last_text", t.slice(0, 300));
  chat.set("last_at", new Date().toISOString());
  chat.set("unread", (+chat.get("unread") || 0) + 1);
  chat.set("answered", false);
  app.save(chat);

  const m = new Record(app.findCollectionByNameOrId("chat_messages"));
  m.set("chat", chat.id);
  m.set("side", "client");
  m.set("text", t);
  m.set("via", from);
  app.save(m);

  try {
    const s = shop.settings(app);
    const where = from === "tg" ? "Телеграм" : from === "max" ? "MAX" : "сайт";
    const who = [chat.get("name"), chat.get("phone")].filter(Boolean).join(", ") || "покупатель";
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", {
      chat_id: adm,
      text: `💬 ${where} — ${who}\n\n«${t.slice(0, 900)}»\n\nОтветьте на это сообщение [chat:${chat.id}]`,
      reply_markup: { force_reply: true },
    }));
  } catch (err) { console.log("chat from bot", err); }
  return chat;
}

// Ответ менеджера: в ленту он уже записан, здесь доставляем его человеку
function deliver(app, chat, text) {
  const from = String(chat.get("last_from") || "site");
  if (from === "site") return { ok: true };            // сайт заберёт сам, когда покупатель откроет окно
  let cust = null;
  try { cust = app.findRecordById("customers", chat.get("customer")); } catch (_) {}
  if (!cust) return { ok: false, error: "Не знаем, кому писать." };
  const s = shop.settings(app);
  if (from === "tg" && cust.get("tg_chat")) {
    const r = shop.tg(shop.clientToken(s), "sendMessage", { chat_id: cust.get("tg_chat"), text });
    return r && r.ok ? { ok: true } : { ok: false, error: "Телеграм не принял сообщение." };
  }
  if (from === "max" && cust.get("max_chat")) {
    const mx = require(`${__hooks}/lib/max.js`);
    const r = mx.send(s.get("max_token"), cust.get("max_chat"), text);
    return r && r.ok ? { ok: true } : { ok: false, error: (r && r.error) || "MAX не принял сообщение." };
  }
  return { ok: false, error: "У покупателя нет этого мессенджера." };
}

module.exports = { chatFor, fromClient, deliver };
