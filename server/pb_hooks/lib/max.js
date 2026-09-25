// Мессенджер MAX: статусы заказа и вход в личный кабинет — то же, что клиентский бот Телеграма.
// Отличия от Телеграма: адрес botapi.max.ru, ключ идёт заголовком Authorization
// (через адрес строки больше нельзя), получатель — в параметрах адреса, текст — в теле,
// а позиция чтения событий называется marker, а не offset.
const shop = require(`${__hooks}/lib/shop.js`);

// Адрес API ботов MAX. Раньше был platform-api2.max.ru — он больше не отвечает,
// рабочий адрес botapi.max.ru, ключ идёт заголовком Authorization.
const BASE = "https://botapi.max.ru";

function call(token, method, path, body) {
  if (!token) return { ok: false, error: "Не указан ключ бота MAX." };
  try {
    const headers = { "Authorization": String(token) };
    if (body) headers["content-type"] = "application/json";
    const res = $http.send({
      url: BASE + path,
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers,
      timeout: 40,
    });
    if (res.statusCode === 401 || res.statusCode === 403) return { ok: false, error: "Ключ бота MAX не подошёл." };
    if (res.statusCode >= 400) {
      const msg = res.json && (res.json.message || res.json.error) ? (res.json.message || res.json.error) : `ошибка ${res.statusCode}`;
      return { ok: false, error: `MAX: ${msg}` };
    }
    return { ok: true, data: res.json || {} };
  } catch (err) {
    console.log("max", path, err);
    return { ok: false, error: "Нет связи с MAX." };
  }
}

// Сообщение пользователю. В MAX не больше двух сообщений в секунду на собеседника.
function send(token, userId, text) {
  if (!userId) return { ok: false, error: "Не указан получатель." };
  return call(token, "POST", `/messages?user_id=${encodeURIComponent(String(userId))}`, { text: String(text).slice(0, 4000) });
}

// Фото в MAX — в три шага: просим место под картинку, кладём туда файл,
// и только потом отправляем сообщение со ссылкой на загруженное (token).
// Ссылкой отправлять нельзя: MAX показал бы просто текст, а не картинку.
function sendPhoto(token, userId, path, text) {
  if (!userId) return { ok: false, error: "Не указан получатель." };
  if (!path) return { ok: false, error: "Нет файла." };

  const place = call(token, "POST", "/uploads?type=image");
  if (!place.ok) return place;
  const url = place.data && place.data.url;
  if (!url) return { ok: false, error: "MAX не дал адрес для загрузки фото." };

  let photoToken = "";
  try {
    const form = new FormData();
    form.append("data", $filesystem.fileFromPath(path));
    const res = $http.send({ url, method: "POST", body: form, timeout: 60 });
    if (res.statusCode >= 400) console.log("max upload", res.statusCode, toString(res.body));
    const photos = (res.json || {}).photos || {};
    const first = Object.keys(photos)[0];
    photoToken = first ? String(photos[first].token || "") : "";
  } catch (err) {
    console.log("max upload", err);
  }
  if (!photoToken) return { ok: false, error: "Не вышло загрузить фото в MAX." };

  // MAX обрабатывает картинку не мгновенно: пока не готова, отвечает «attachment.not.ready».
  // Ждём и пробуем ещё — обычно хватает одной-двух секунд.
  const body = { text: String(text || "").slice(0, 4000), attachments: [{ type: "image", payload: { token: photoToken } }] };
  const to = `/messages?user_id=${encodeURIComponent(String(userId))}`;
  let last = null;
  for (let i = 0; i < 6; i++) {
    last = call(token, "POST", to, body);
    if (last.ok) return last;
    if (!/not\.?\s?ready/i.test(String(last.error || ""))) return last;
    try { $os.cmd("sleep", "2").output(); } catch (_) {}
  }
  return last;
}

// Кто мы: проверка ключа и имя бота для ссылки max.ru/<имя>
function me(token) { return call(token, "GET", "/me"); }

// Новые события. marker — позиция с прошлого раза.
function updates(token, marker) {
  const q = `/updates?timeout=20&limit=100&types=message_created,bot_started` + (marker ? `&marker=${marker}` : "");
  return call(token, "GET", q);
}

// Из события достаём отправителя и текст — у разных типов они лежат по-разному
function partsOf(u) {
  const m = u.message || {};
  const sender = m.sender || u.user || {};
  const userId = sender.user_id || (m.recipient && m.recipient.user_id) || "";
  const name = [sender.first_name, sender.last_name].filter(Boolean).join(" ");
  const text = String((m.body && m.body.text) || "").trim();
  return { userId: userId ? String(userId) : "", name, text };
}

// Покупатель по собеседнику в MAX (заводим при первом входе)
function customerOf(app, chat, name) {
  let c = null;
  try { c = app.findFirstRecordByFilter("customers", "max_chat = {:c}", { c: String(chat) }); } catch (_) {}
  if (!c) {
    c = new Record(app.findCollectionByNameOrId("customers"));
    c.set("max_chat", String(chat));
    c.set("name", name || "");
  }
  if (name && !c.get("max_name")) c.set("max_name", name);
  if (!c.get("token")) c.set("token", $security.randomString(40));
  app.save(c);
  return c;
}

// Одно событие от MAX.
// Ссылок с заранее заданным кодом (как /start в Телеграме) в MAX нет,
// поэтому покупатель просто присылает код с сайта сообщением.
function handle(app, u) {
  const s = shop.settings(app);
  const token = s.get("max_token");
  if (!token) return;
  const { userId, name, text } = partsOf(u);
  if (!userId) return;
  const site = String(s.get("site_url") || "").replace(/\/$/, "");
  const say = (t) => send(token, userId, t);

  if (u.update_type === "bot_started" && !text) {
    return say(`Здравствуйте! Это бот магазина venikoff.net.\n\nПришлите код с сайта, чтобы войти в личный кабинет, — или просто напишите что угодно, и я покажу, что с вашим заказом.${site ? `\n\nКаталог: ${site}` : ""}`);
  }

  const code = (text.match(/\b([A-Za-z0-9]{6,40})\b/) || [])[1] || "";

  // код входа в кабинет
  if (code) {
    let rec = null;
    try { rec = app.findFirstRecordByFilter("logins", "code = {:c}", { c: code }); } catch (_) {}
    if (rec) {
      const c = customerOf(app, userId, name);
      rec.set("customer", c.id);
      app.save(rec);
      return say(`Готово, ${name || "вы"} вошли на сайте venikoff.net.\n\nЗдесь будут статусы заказов и фото букета перед доставкой.`);
    }
    // код подписки на заказ
    let order = null;
    try { order = app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: code }); } catch (_) {}
    if (order) {
      order.set("max_chat", String(userId));
      app.save(order);
      shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", {
        chat_id: adm, text: `📱 ${order.get("name")} (${order.get("phone")}) подписался на статусы заказа №${order.get("number")} в MAX` }));
      return say(`Заказ №${order.get("number")} на ${shop.rub(order.get("total"))} принят.\n${order.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${shop.whenText(order)}.\n\nБудем присылать сюда статусы и фото букета.`);
    }
  }

  // ждём ответ по фото букета — кнопок в MAX нет, разбираем обычный текст
  let waiting = null;
  try { waiting = app.findFirstRecordByFilter("orders", "max_chat = {:c} && photo_status = 'waiting'", { c: String(userId) }); } catch (_) {}
  if (waiting && text) {
    const likes = /^(да|ага|нравится|супер|отлично|класс|хорошо|ок|okay|ok|👍|\+)\b/i.test(text);
    waiting.set("photo_status", likes ? "approved" : "rework");
    if (!likes) waiting.set("photo_comment", text.slice(0, 500));
    app.save(waiting);
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: adm,
      text: likes
        ? `👍 Клиент одобрил фото по заказу №${waiting.get("number")} (MAX)`
        : `👎 Клиент просит поправить букет по заказу №${waiting.get("number")} (MAX): ${text.slice(0, 500)}` }));
    return say(likes ? "Спасибо! Везём." : "Спасибо, передали флористу — поправим.");
  }

  // обычное сообщение: состояние последнего заказа
  let last = null;
  try { last = app.findFirstRecordByFilter("orders", "max_chat = {:c}", { c: String(userId) }); } catch (_) {}
  if (last) {
    return say(`Заказ №${last.get("number")} — ${shop.STATUS[last.get("status")] || last.get("status")}\n${last.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${shop.whenText(last)}\nСумма: ${shop.rub(last.get("total"))}${last.get("payment_status") === "paid" ? " (оплачено)" : ""}${site ? `\n\nВсе заказы: ${site}/#/me` : ""}`);
  }
  return say(`Здравствуйте! Это бот магазина venikoff.net.\n\nПришлите код с сайта, чтобы войти в личный кабинет и следить за заказом.${site ? `\n\nКаталог: ${site}` : ""}`);
}

module.exports = { call, send, sendPhoto, me, updates, handle, customerOf, partsOf, BASE };
