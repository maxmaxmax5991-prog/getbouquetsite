// Рассылки: подключённые боты, их подписчики и отправка.
//
// Источники получателей:
//   "client" — покупатели в нашем клиентском боте Телеграма (customers.tg_chat)
//   "max"    — покупатели в MAX (customers.max_chat)
//   <id>     — любой подключённый по ключу Телеграм-бот (bc_bots), подписчики в bc_subs
//
// Отправка идёт заданием раз в минуту небольшими порциями, место остановки (cursor)
// пишется после КАЖДОГО сообщения: перезапуск сервера посреди рассылки не пришлёт
// никому второе такое же сообщение.
const shop = require(`${__hooks}/lib/shop.js`);

const TG = "https://api.telegram.org/bot";

function pause(ms) {
  try { sleep(ms); } catch (_) { try { $os.cmd("sleep", String(Math.ceil(ms / 1000))).output(); } catch (__) {} }
}

// Разрешаем только простую разметку: жирный, курсив, подчёркнутый, зачёркнутый и ссылки.
// Всё остальное экранируем — иначе случайный «<» в тексте ломал бы отправку целиком.
function clean(text) {
  let s = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  s = s.replace(/&lt;(\/?)(b|i|u|s)&gt;/g, "<$1$2>");
  s = s.replace(/&lt;a href="(https?:\/\/[^"<>\s]+)"&gt;/g, '<a href="$1">').replace(/&lt;\/a&gt;/g, "</a>");
  return s;
}
const plain = (text) => String(text || "").replace(/<\/?(b|i|u|s)>/g, "").replace(/<a href="[^"]*">|<\/a>/g, "");

// ---------- Телеграм ----------
function tgCall(token, method, payload) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = $http.send({
        url: `${TG}${token}/${method}`,
        method: "POST",
        body: payload instanceof FormData ? payload : JSON.stringify(payload || {}),
        headers: payload instanceof FormData ? {} : { "content-type": "application/json" },
        timeout: 40,
      });
    } catch (err) {
      if (attempt === 3) return { ok: false, description: "Нет связи с Телеграмом" };
      pause(1000);
      continue;
    }
    const j = res.json || {};
    // слишком часто — Телеграм сам говорит, сколько подождать
    if (res.statusCode === 429 && attempt < 3) {
      pause(Math.min(30, (j.parameters && j.parameters.retry_after) || 3) * 1000);
      continue;
    }
    j.status = res.statusCode;
    return j;
  }
  return { ok: false };
}

// Одно сообщение в Телеграм. cache — память на время прогона: файл фото загружаем
// в каждого бота один раз, дальше шлём по file_id (у каждого бота свои file_id).
function tgSend(token, chat, m, cache) {
  const kb = m.button_text && m.button_url ? { inline_keyboard: [[{ text: m.button_text, url: m.button_url }]] } : null;
  const html = clean(m.text);
  const sendText = (withKb) => {
    const p = { chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: !!m.photo };
    if (withKb && kb) p.reply_markup = kb;
    let r = tgCall(token, "sendMessage", p);
    if (!r.ok && r.status === 400 && /parse entities/i.test(r.description || "")) {
      delete p.parse_mode; p.text = plain(m.text);            // разметка сломана — шлём простым текстом
      r = tgCall(token, "sendMessage", p);
    }
    return r;
  };

  let r;
  if (m.photo) {
    const key = "tg:" + token;
    const shortText = html.length <= 1000;                     // подпись к фото — до 1024 знаков
    const build = (usePath) => {
      const f = new FormData();
      f.append("chat_id", String(chat));
      if (shortText && m.text) { f.append("caption", html); f.append("parse_mode", "HTML"); }
      if (shortText && kb) f.append("reply_markup", JSON.stringify(kb));
      f.append("photo", usePath ? $filesystem.fileFromPath(m.photo) : cache[key]);
      return f;
    };
    r = cache[key] ? tgCall(token, "sendPhoto", build(false)) : null;
    if (!r || !r.ok && r.status === 400) r = tgCall(token, "sendPhoto", build(true));
    if (r.ok && r.result && r.result.photo && r.result.photo.length) cache[key] = r.result.photo[r.result.photo.length - 1].file_id;
    if (r.ok && !shortText && m.text) r = sendText(true);       // длинный текст — отдельным сообщением
  } else {
    r = sendText(true);
  }
  return {
    ok: !!r.ok,
    // 403 — пользователь остановил бота или удалил аккаунт; 400 chat not found — ни разу не нажимал «Старт»
    gone: r.status === 403 || (r.status === 400 && /chat not found|user is deactivated/i.test(r.description || "")),
    error: r.ok ? "" : r.status === 401 || r.status === 404 ? "ключ бота не работает" : String(r.description || "ошибка"),
  };
}

// ---------- MAX ----------
function maxSend(token, userId, m, cache) {
  const mx = require(`${__hooks}/lib/max.js`);
  const atts = [];
  if (m.photo) {
    if (!cache.maxPhoto) {
      const place = mx.call(token, "POST", "/uploads?type=image");
      const url = place.ok && place.data && place.data.url;
      if (url) {
        try {
          const f = new FormData();
          f.append("data", $filesystem.fileFromPath(m.photo));
          const res = $http.send({ url, method: "POST", body: f, timeout: 60 });
          const photos = (res.json || {}).photos || {};
          const first = Object.keys(photos)[0];
          if (first) cache.maxPhoto = String(photos[first].token || "");
        } catch (err) { console.log("bc max upload", err); }
      }
    }
    if (cache.maxPhoto) atts.push({ type: "image", payload: { token: cache.maxPhoto } });
  }
  if (m.button_text && m.button_url) atts.push({ type: "inline_keyboard", payload: { buttons: [[mx.btnLink(m.button_text, m.button_url)]] } });
  const body = { text: clean(m.text).slice(0, 4000), format: "html" };
  if (atts.length) body.attachments = atts;
  let r = null;
  for (let i = 0; i < 6; i++) {
    r = mx.call(token, "POST", `/messages?user_id=${encodeURIComponent(String(userId))}`, body);
    if (r.ok || !/not\.?\s?ready/i.test(String(r.error || ""))) break;
    pause(2000);
  }
  return { ok: !!r.ok, gone: false, error: r.ok ? "" : String(r.error || "ошибка") };
}

// ---------- источники ----------
function sources(app) {
  const s = shop.settings(app);
  const count = (sql, bind) => {
    try { const row = new DynamicModel({ n: 0 }); app.db().newQuery(sql).bind(bind || {}).one(row); return row.n; } catch (_) { return 0; }
  };
  const out = [];
  if (s.get("tg_client_token")) {
    out.push({ id: "client", kind: "tg", builtin: true, title: s.get("tg_client_bot") ? "@" + s.get("tg_client_bot") : "Клиентский бот",
      note: "покупатели магазина", count: count("SELECT COUNT(*) AS n FROM customers WHERE tg_chat != ''") });
  }
  if (s.get("max_token")) {
    out.push({ id: "max", kind: "max", builtin: true, title: s.get("max_bot") ? "MAX · " + s.get("max_bot") : "MAX",
      note: "покупатели в MAX", count: count("SELECT COUNT(*) AS n FROM customers WHERE max_chat != ''") });
  }
  app.findRecordsByFilter("bc_bots", "id != ''", "created", 200, 0).forEach((b) => {
    out.push({
      id: b.id, kind: "tg", builtin: false, title: b.get("username") ? "@" + b.get("username") : b.get("title") || "Бот",
      note: b.get("title") || "", active: !!b.get("active"), hello: b.get("hello") || "", error: b.get("error") || "",
      count: count("SELECT COUNT(*) AS n FROM bc_subs WHERE bot = {:b} AND blocked = FALSE", { b: b.id }),
      blocked: count("SELECT COUNT(*) AS n FROM bc_subs WHERE bot = {:b} AND blocked = TRUE", { b: b.id }),
    });
  });
  return out;
}

// Ключ и способ отправки для источника
function channel(app, s, src) {
  if (src === "client") return s.get("tg_client_token") ? { kind: "tg", token: s.get("tg_client_token") } : null;
  if (src === "max") return s.get("max_token") ? { kind: "max", token: s.get("max_token") } : null;
  try { const b = app.findRecordById("bc_bots", src); return b.get("active") ? { kind: "tg", token: b.get("token"), bot: b } : null; } catch (_) { return null; }
}

// Следующая порция получателей источника после id last
function batch(app, src, last, n) {
  if (src === "client") return app.findRecordsByFilter("customers", "tg_chat != '' && id > {:l}", "id", n, 0, { l: last || "" }).map((c) => ({ id: c.id, chat: c.get("tg_chat") }));
  if (src === "max") return app.findRecordsByFilter("customers", "max_chat != '' && id > {:l}", "id", n, 0, { l: last || "" }).map((c) => ({ id: c.id, chat: c.get("max_chat") }));
  return app.findRecordsByFilter("bc_subs", "bot = {:b} && blocked = false && id > {:l}", "id", n, 0, { b: src, l: last || "" }).map((c) => ({ id: c.id, chat: c.get("chat"), sub: true }));
}

function photoPath(app, rec) {
  const f = rec.get("photo");
  return f ? `${app.dataDir()}/storage/${rec.collection().id}/${rec.id}/${f}` : "";
}
function message(app, rec) {
  return { text: rec.get("text") || "", button_text: rec.get("button_text") || "", button_url: rec.get("button_url") || "", photo: photoPath(app, rec) };
}

// Один прогон рассылки до срока until. Возвращает true, если рассылка закончилась.
function run(app, rec, until, cache) {
  const s = shop.settings(app);
  const m = message(app, rec);
  const targets = shop.jget(rec, "targets") || [];
  const cur = shop.jget(rec, "cursor") || {};
  let i = +cur.i || 0, last = cur.last || "";
  let sent = +rec.get("sent") || 0, failed = +rec.get("failed") || 0;

  const save = (extra) => {
    const set = Object.assign({ sent, failed, cursor: JSON.stringify({ i, last }) }, extra || {});
    const cols = Object.keys(set).map((k) => `${k} = {:${k}}`).join(", ");
    app.db().newQuery(`UPDATE broadcasts SET ${cols} WHERE id = {:id}`).bind(Object.assign({ id: rec.id }, set)).execute();
  };
  const stopped = () => {
    try { return app.findRecordById("broadcasts", rec.id).get("status") === "stopped"; } catch (_) { return true; }
  };

  if (rec.get("status") === "queued") save({ status: "sending" });
  let checks = 0;
  while (i < targets.length && Date.now() < until) {
    const ch = channel(app, s, targets[i]);
    const list = ch ? batch(app, targets[i], last, 25) : [];
    if (!list.length) { i++; last = ""; save(); continue; }
    for (const r of list) {
      if (Date.now() >= until) break;
      const res = ch.kind === "max" ? maxSend(ch.token, r.chat, m, cache) : tgSend(ch.token, r.chat, m, cache);
      if (res.ok) sent++; else failed++;
      if (!res.ok && res.gone && r.sub) {
        try { app.db().newQuery("UPDATE bc_subs SET blocked = TRUE WHERE id = {:id}").bind({ id: r.id }).execute(); } catch (_) {}
      }
      last = r.id;
      save();
      if (ch.kind === "tg") pause(40);                      // Телеграм пускает ~30 сообщений в секунду
      if (++checks % 20 === 0 && stopped()) return true;   // нажали «Остановить»
    }
  }
  if (i >= targets.length) { save({ status: "done", finished: new Date().toISOString() }); return true; }
  return false;
}

// ---------- опрос подключённых ботов: кто пишет — тот подписчик ----------
function remember(app, bot, from, blocked) {
  if (!from || !from.id) return;
  const chat = String(from.id);
  let sub = null;
  try { sub = app.findFirstRecordByFilter("bc_subs", "bot = {:b} && chat = {:c}", { b: bot.id, c: chat }); } catch (_) {}
  if (!sub) sub = new Record(app.findCollectionByNameOrId("bc_subs"));
  sub.set("bot", bot.id);
  sub.set("chat", chat);
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
  if (name) sub.set("name", name.slice(0, 200));
  if (from.username) sub.set("username", String(from.username).slice(0, 120));
  sub.set("blocked", !!blocked);
  try { app.save(sub); } catch (err) { console.log("bc sub", err); }
}

function poll(app, bot) {
  const token = bot.get("token");
  const setErr = (msg) => {
    if ((bot.get("error") || "") === msg) return;
    try { app.db().newQuery("UPDATE bc_bots SET error = {:e} WHERE id = {:id}").bind({ e: msg, id: bot.id }).execute(); bot.set("error", msg); } catch (_) {}
  };
  let offset = +bot.get("offset") || 0;
  let res;
  try {
    res = $http.send({ url: `${TG}${token}/getUpdates?timeout=0&offset=${offset}&allowed_updates=["message","my_chat_member","callback_query"]`, method: "GET", timeout: 20 });
  } catch (_) { return; }
  if (res.statusCode === 409) return setErr("Бот подключён к другому сервису (webhook). Подписчики не собираются.");
  if (res.statusCode === 401 || res.statusCode === 404) return setErr("Ключ бота больше не работает — его сменили в @BotFather.");
  if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
  setErr("");
  const hello = bot.get("hello");
  (res.json.result || []).forEach((u) => {
    offset = u.update_id + 1;
    try { app.db().newQuery("UPDATE bc_bots SET offset = {:o} WHERE id = {:id}").bind({ o: offset, id: bot.id }).execute(); } catch (_) {}
    try {
      if (u.my_chat_member && u.my_chat_member.chat && u.my_chat_member.chat.type === "private") {
        const st = u.my_chat_member.new_chat_member && u.my_chat_member.new_chat_member.status;
        remember(app, bot, u.my_chat_member.from, st === "kicked");
      } else if (u.message && u.message.chat && u.message.chat.type === "private") {
        remember(app, bot, u.message.from, false);
        if (hello && /^\/start/.test(String(u.message.text || ""))) tgCall(token, "sendMessage", { chat_id: u.message.chat.id, text: hello });
      } else if (u.callback_query) {
        remember(app, bot, u.callback_query.from, false);
      }
    } catch (err) { console.log("bc poll", err); }
  });
}

module.exports = { clean, plain, sources, channel, message, photoPath, run, poll, tgSend, maxSend, tgCall, pause };
