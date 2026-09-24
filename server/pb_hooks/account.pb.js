/// <reference path="../pb_data/types.d.ts" />
// Вход покупателя через Телеграм и личный кабинет.

// 1. Сайт просит код входа
routerAdd("POST", "/api/shop/login-start", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  const bot = s.get("tg_client_bot") || s.get("tg_bot");
  const maxBot = s.get("max_token") ? (s.get("max_bot") || "") : "";
  if (!bot && !maxBot) return e.json(400, { message: "Вход через мессенджер пока не настроен." });
  const code = $security.randomString(24);
  const rec = new Record($app.findCollectionByNameOrId("logins"));
  rec.set("code", code);
  $app.save(rec);
  // В MAX ссылок с заранее заданным кодом нет, поэтому покупатель присылает код сообщением.
  return e.json(200, {
    code,
    link: bot ? `https://t.me/${bot}?start=l${code}` : "",
    max_link: maxBot ? `https://max.ru/${maxBot}` : "",
  });
});

// 2. Сайт ждёт подтверждения из бота
routerAdd("POST", "/api/shop/login-check", (e) => {
  const acc = require(`${__hooks}/lib/account.js`);
  const body = e.requestInfo().body || {};
  let rec;
  try { rec = $app.findFirstRecordByFilter("logins", "code = {:c}", { c: String(body.code || "") }); } catch (_) { return e.json(404, { message: "Код не найден" }); }
  if (!rec.get("customer")) return e.json(200, { waiting: true });
  const c = $app.findRecordById("customers", rec.get("customer"));
  $app.delete(rec);
  return e.json(200, { token: c.get("token"), name: c.get("name") || c.get("tg_name") || "", phone: c.get("phone") || "" });
});

// 3. Кабинет: профиль и заказы
routerAdd("GET", "/api/shop/my", (e) => {
  const acc = require(`${__hooks}/lib/account.js`);
  const c = acc.byToken($app, e.request.header.get("X-Customer-Token"));
  if (!c) return e.json(401, { message: "Войдите заново" });
  return e.json(200, {
    name: c.get("name") || c.get("tg_name") || "",
    phone: c.get("phone") || "",
    orders: acc.ordersOf($app, c),
  });
});

// 4. Сохранить имя и телефон
routerAdd("POST", "/api/shop/my", (e) => {
  const acc = require(`${__hooks}/lib/account.js`);
  const c = acc.byToken($app, e.request.header.get("X-Customer-Token"));
  if (!c) return e.json(401, { message: "Войдите заново" });
  const body = e.requestInfo().body || {};
  if (body.name !== undefined) c.set("name", String(body.name).slice(0, 120));
  if (body.phone !== undefined) c.set("phone", String(body.phone).slice(0, 40));
  $app.save(c);
  return e.json(200, { ok: true });
});

// 5. Заказ от вошедшего покупателя — сразу привязан к кабинету и к боту.
// Если покупатель не вошёл, но его телефон нам уже знаком, привязываем по телефону:
// иначе бот потом не знает, кому слать фото букета.
const onlyDigits = (v) => String(v || "").replace(/\D/g, "").replace(/^8/, "7");

onRecordCreateRequest((e) => {
  try {
    const acc = require(`${__hooks}/lib/account.js`);
    let c = acc.byToken($app, e.request ? e.request.header.get("X-Customer-Token") : null);
    if (!c) {
      const phone = onlyDigits(e.record.get("phone"));
      if (phone.length >= 10) {
        try {
          c = $app.findRecordsByFilter("customers", "phone != ''", "-created", 500, 0)
            .find((x) => onlyDigits(x.get("phone")) === phone) || null;
        } catch (_) { c = null; }
      }
    }
    if (c) {
      e.record.set("customer", c.id);
      // чат запоминаем в самом заказе: фото и статусы уходят именно по этому заказу,
      // даже если потом покупатель сделает второй
      if (c.get("tg_chat")) e.record.set("tg_chat", c.get("tg_chat"));
      if (c.get("max_chat")) e.record.set("max_chat", c.get("max_chat"));
      // запоминаем телефон покупателю: по нему узнаем его в следующий раз,
      // даже если он закажет не входя в кабинет
      if (!c.get("phone") && e.record.get("phone")) {
        c.set("phone", e.record.get("phone"));
        if (!c.get("name") && e.record.get("name")) c.set("name", e.record.get("name"));
        try { $app.save(c); } catch (_) {}
      }
    }
  } catch (err) { console.log("bind customer", err); }
  e.next();
}, "orders");

// 6. Рассылка всем покупателям, кто пользуется клиентским ботом
routerAdd("POST", "/api/shop/broadcast", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const body = e.requestInfo().body || {};
  const text = String(body.text || "").trim();
  if (text.length < 3) return e.json(400, { message: "Напишите текст сообщения" });
  const s = shop.settings($app);
  const token = shop.clientToken(s);
  const maxToken = s.get("max_token");
  if (!token && !maxToken) return e.json(400, { message: "Бот не подключён" });
  // рассылка уходит и в Телеграм, и в MAX — каждому туда, где он подписан
  const list = $app.findRecordsByFilter("customers", "tg_chat != '' || max_chat != ''", "-created", 2000, 0);
  const mx = maxToken ? require(`${__hooks}/lib/max.js`) : null;
  let sent = 0, failed = 0;
  list.forEach((c) => {
    let ok = false;
    if (token && c.get("tg_chat")) { const r = shop.tg(token, "sendMessage", { chat_id: c.get("tg_chat"), text }); ok = !!(r && r.ok); }
    if (mx && c.get("max_chat")) { const r = mx.send(maxToken, c.get("max_chat"), text); ok = ok || !!(r && r.ok); }
    if (ok) sent++; else failed++;
  });
  return e.json(200, { sent, failed, total: list.length });
}, $apis.requireAuth("managers"));

// 7. Сколько получателей у рассылки
routerAdd("GET", "/api/shop/broadcast", (e) => {
  const list = $app.findRecordsByFilter("customers", "tg_chat != '' || max_chat != ''", "", 2000, 0);
  return e.json(200, { total: list.length });
}, $apis.requireAuth("managers"));

// 8. Проверка клиентского бота и запоминание его имени
routerAdd("POST", "/api/shop/client-bot-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  const token = s.get("tg_client_token");
  if (!token) return e.json(400, { message: "Ключ клиентского бота не указан" });
  const me = shop.tg(token, "getMe", {});
  if (!me || !me.ok) return e.json(400, { message: "Ключ не подошёл" });
  shop.tg(token, "deleteWebhook", { drop_pending_updates: false });
  s.set("tg_client_bot", me.result.username);
  $app.save(s);
  return e.json(200, { bot: me.result.username });
}, $apis.requireAuth("managers"));
