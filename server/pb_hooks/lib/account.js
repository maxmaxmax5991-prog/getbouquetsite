// Личный кабинет покупателя: вход через Телеграм, свои заказы.
const shop = require(`${__hooks}/lib/shop.js`);

// Покупатель по ключу сессии
function byToken(app, token) {
  if (!token || String(token).length < 20) return null;
  try { return app.findFirstRecordByFilter("customers", "token = {:t}", { t: String(token) }); } catch (_) { return null; }
}

// Покупатель по чату в Телеграме (создаём при первом входе)
function byChat(app, chat, tgName) {
  let c = null;
  try { c = app.findFirstRecordByFilter("customers", "tg_chat = {:c}", { c: String(chat) }); } catch (_) {}
  if (!c) {
    c = new Record(app.findCollectionByNameOrId("customers"));
    c.set("tg_chat", String(chat));
    c.set("name", tgName || "");
  }
  if (tgName && !c.get("tg_name")) c.set("tg_name", tgName);
  if (!c.get("token")) c.set("token", $security.randomString(40));
  app.save(c);
  return c;
}

// Заказы покупателя: свои по связи, плюс старые по телефону и чату
function ordersOf(app, c) {
  const phone = String(c.get("phone") || "").replace(/\D/g, "").slice(-10);
  const parts = [`customer = "${c.id}"`];
  if (c.get("tg_chat")) parts.push(`tg_chat = "${c.get("tg_chat")}"`);
  if (c.get("max_chat")) parts.push(`max_chat = "${c.get("max_chat")}"`);
  if (phone.length === 10) parts.push(`phone ~ "${phone}"`);
  const list = app.findRecordsByFilter("orders", parts.join(" || "), "-created", 50, 0);
  return list.map((o) => ({
    id: o.id,
    number: o.get("number"),
    created: o.get("created"),
    status: o.get("status"),
    status_text: shop.STATUS[o.get("status")] || o.get("status"),
    items: shop.jget(o, "items") || [],
    total: o.get("total"),
    delivery_price: o.get("delivery_price"),
    delivery_type: o.get("delivery_type"),
    address: o.get("address"),
    date: o.get("date"),
    interval: o.get("interval"),
    note: o.get("note"),
    payment_method: o.get("payment_method"),
    payment_status: o.get("payment_status"),
    subscribed: !!(o.get("tg_chat") || o.get("max_chat")),
    tg_code: o.get("tg_code"),
  }));
}

module.exports = { byToken, byChat, ordersOf };
