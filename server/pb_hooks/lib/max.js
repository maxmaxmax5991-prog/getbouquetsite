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

// Кнопки под сообщением. В MAX это вложение inline_keyboard:
// строки кнопок, кнопка либо «callback» (присылает боту метку), либо «link» (открывает адрес).
const btn = (text, payload) => ({ type: "callback", text, payload: String(payload).slice(0, 1024) });
const btnLink = (text, url) => ({ type: "link", text, url: String(url).slice(0, 2048) });
const keyboard = (rows) => ({ type: "inline_keyboard", payload: { buttons: rows } });

// Сообщение пользователю. В MAX не больше двух сообщений в секунду на собеседника.
function send(token, userId, text, rows) {
  if (!userId) return { ok: false, error: "Не указан получатель." };
  const body = { text: String(text).slice(0, 4000) };
  if (rows && rows.length) body.attachments = [keyboard(rows)];
  return call(token, "POST", `/messages?user_id=${encodeURIComponent(String(userId))}`, body);
}

// Ответ на нажатие кнопки: короткое всплывающее уведомление.
// Если MAX его не поддержит — не беда, следом всё равно идёт обычное сообщение.
function answer(token, callbackId, note) {
  if (!callbackId) return { ok: false };
  return call(token, "POST", `/answers?callback_id=${encodeURIComponent(String(callbackId))}`, { notification: String(note || "").slice(0, 200) });
}

// Фото в MAX — в три шага: просим место под картинку, кладём туда файл,
// и только потом отправляем сообщение со ссылкой на загруженное (token).
// Ссылкой отправлять нельзя: MAX показал бы просто текст, а не картинку.
function sendPhoto(token, userId, path, text, rows) {
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
  if (rows && rows.length) body.attachments.push(keyboard(rows));
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
  const q = `/updates?timeout=20&limit=100&types=message_created,bot_started,message_callback` + (marker ? `&marker=${marker}` : "");
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

// Код с сайта: вход в кабинет или подписка на заказ.
// Приходит двумя путями — по ссылке max.ru/<бот>?start=l_<код> (тогда лежит в payload)
// или сообщением, если человек скопировал код руками.
function useCode(app, s, token, userId, name, code) {
  const site = String(s.get("site_url") || "").replace(/\/$/, "");
  let rec = null;
  try { rec = app.findFirstRecordByFilter("logins", "code = {:c}", { c: code }); } catch (_) {}
  if (rec) {
    const c = customerOf(app, userId, name);
    rec.set("customer", c.id);
    app.save(rec);
    return send(token, userId, `Готово, ${name || "вы"} вошли на сайте venikoff.net.\n\nЗдесь будут статусы заказов и фото букета перед доставкой.`,
      site ? [[btnLink("Мои заказы", `${site}/#/me`)]] : null);
  }
  let order = null;
  try { order = app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: code }); } catch (_) {}
  if (order) {
    order.set("max_chat", String(userId));
    app.save(order);
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", {
      chat_id: adm, text: `📱 ${order.get("name")} (${order.get("phone")}) подписался на статусы заказа №${order.get("number")} в MAX` }));
    return send(token, userId, `Заказ №${order.get("number")} на ${shop.rub(order.get("total"))} принят.\n${order.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${shop.whenText(order)}.\n\nБудем присылать сюда статусы и фото букета.`,
      site ? [[btnLink("Мой заказ", `${site}/#/order/${order.get("tg_code")}`)]] : null);
  }
  return null;
}

// Нажали кнопку под сообщением. Метки те же, что в Телеграме:
// ap — нравится, rw — поправить, rr — какая именно правка.
function onButton(app, s, token, cb) {
  const userId = String((cb.user && cb.user.user_id) || "");
  const parts = String(cb.payload || "").split(":");
  const say = (t, rows) => send(token, userId, t, rows);
  let ord = null;
  try { ord = app.findRecordById("orders", parts[1] || ""); } catch (_) {}
  if (!ord) { answer(token, cb.callback_id, "Заказ не найден"); return; }

  if (parts[0] === "ap") {
    if (ord.get("photo_status") === "approved") { answer(token, cb.callback_id, "Уже передали, спасибо!"); return; }
    ord.set("photo_status", "approved");
    app.save(ord);
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: adm,
      text: `👍 Клиент одобрил фото по заказу №${ord.get("number")} (MAX)` }));
    answer(token, cb.callback_id, "Спасибо!");
    return say("Спасибо! Везём ваш букет.");
  }

  if (parts[0] === "rw") {
    ord.set("photo_status", "rework");
    app.save(ord);
    answer(token, cb.callback_id, "");
    return say("Что поправить?", [
      [btn("🎨 Не те цвета", `rr:${ord.id}:1`), btn("🌸 Не те цветы", `rr:${ord.id}:2`)],
      [btn("📏 Маловат букет", `rr:${ord.id}:3`), btn("🎁 Другая упаковка", `rr:${ord.id}:4`)],
      [btn("📞 Пусть позвонят", `rr:${ord.id}:5`)],
    ]);
  }

  if (parts[0] === "rr") {
    const REASONS = { "1": "не те цвета", "2": "не те цветы", "3": "маловат букет", "4": "другая упаковка", "5": "просит позвонить" };
    const reason = REASONS[parts[2]] || "не подошёл букет";
    answer(token, cb.callback_id, "");
    if (ord.get("photo_status") === "rework" && ord.get("photo_comment") === reason) return;   // повтор того же нажатия
    ord.set("photo_comment", reason);
    ord.set("photo_status", "rework");
    app.save(ord);
    const call = parts[2] === "5";
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: adm,
      text: call
        ? `📞 Заказ №${ord.get("number")} (MAX): клиент просит позвонить — ${ord.get("name")}, ${ord.get("phone")}`
        : `👎 Заказ №${ord.get("number")} (MAX): клиенту не подошло — ${reason}` }));
    return say(call ? "Сейчас вам позвонит наш флорист." : "Передали флористу. Пришлём новое фото.");
  }
}

// Одно событие от MAX.
function handle(app, u) {
  const s = shop.settings(app);
  const token = s.get("max_token");
  if (!token) return;
  const site = String(s.get("site_url") || "").replace(/\/$/, "");

  if (u.update_type === "message_callback" && u.callback) return onButton(app, s, token, u.callback);

  const { userId, name, text } = partsOf(u);
  if (!userId) return;
  const say = (t, rows) => send(token, userId, t, rows);
  const hello = () => say(`Здравствуйте! Это бот магазина venikoff.net.\n\nЗдесь будут статусы ваших заказов и фото букета перед доставкой.`,
    site ? [[btnLink("Открыть каталог", site)], [btnLink("Мои заказы", `${site}/#/me`)]] : null);

  // пришли по ссылке с сайта: max.ru/<бот>?start=l_<код>
  const payload = String(u.payload || (u.message && u.message.body && u.message.body.payload) || "").trim();
  if (payload) {
    const done = useCode(app, s, token, userId, name, payload.replace(/^[lo]_/, ""));
    if (done) return done;
  }
  if (u.update_type === "bot_started") return hello();

  // код, набранный сообщением, — запасной путь, если ссылка не открылась
  const code = (text.match(/([A-Za-z0-9]{6,40})/) || [])[1] || "";
  if (code) {
    const done = useCode(app, s, token, userId, name, code);
    if (done) return done;
  }

  // Клиент написал словами. Сами ничего не решаем — переспрашиваем кнопками,
  // а текст передаём менеджеру в служебный бот вместе с телефоном, чтобы было кому ответить.
  let waiting = null;
  try { waiting = app.findFirstRecordByFilter("orders", "max_chat = {:c} && photo_status = 'waiting'", { c: String(userId) }); } catch (_) {}
  if (waiting && text) {
    shop.adminIds(s).forEach((adm) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: adm,
      text: `💬 Заказ №${waiting.get("number")} (MAX), клиент пишет: «${text.slice(0, 500)}»\n\n${waiting.get("name")}, ${waiting.get("phone")}` }));
    return say("Спасибо, передали менеджеру. А про букет ответьте, пожалуйста, кнопкой:", [
      [btn("👍 Нравится", `ap:${waiting.id}`), btn("👎 Поправить", `rw:${waiting.id}`)],
    ]);
  }

  // обычное сообщение: состояние последнего заказа
  let last = null;
  try { last = app.findFirstRecordByFilter("orders", "max_chat = {:c}", { c: String(userId) }); } catch (_) {}
  if (last) {
    return say(`Заказ №${last.get("number")} — ${shop.STATUS[last.get("status")] || last.get("status")}\n${last.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${shop.whenText(last)}\nСумма: ${shop.rub(last.get("total"))}${last.get("payment_status") === "paid" ? " (оплачено)" : ""}`,
      site ? [[btnLink("Мой заказ", `${site}/#/order/${last.get("tg_code")}`)], [btnLink("Все заказы", `${site}/#/me`)]] : null);
  }
  return hello();
}

module.exports = { call, send, answer, sendPhoto, btn, btnLink, me, updates, handle, useCode, customerOf, partsOf, BASE };
