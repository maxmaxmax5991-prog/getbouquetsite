// Рассылки: подключённые боты, их подписчики и отправка.
//
// Источники получателей:
//   "tg:<витрина>"  — покупатели в клиентском боте этой витрины
//   "mx:<витрина>"  — покупатели в MAX-боте этой витрины
//   "client"/"max"  — то же, но когда витрин с своими ботами ещё нет (старый вид)
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

// ---------- кто у нас уже покупал ----------
// Заказ привязан к человеку четырьмя способами: карточкой покупателя, чатом
// в Телеграме, чатом в MAX и номером телефона. Собираем всё разом в память
// одним запросом: тот же вопрос через NOT EXISTS по каждому подписчику считался
// почти пять секунд, а список источников открывается на каждый заход в рассылки.
function покупатели(app) {
  const карта = { cust: {}, tg: {}, max: {}, tel: {} };
  try {
    const rows = arrayOf(new DynamicModel({ customer: "", tg_chat: "", max_chat: "", phone: "" }));
    app.db().newQuery("SELECT customer, tg_chat, max_chat, phone FROM orders").all(rows);
    rows.forEach((o) => {
      if (o.customer) карта.cust[o.customer] = 1;
      if (o.tg_chat) карта.tg[String(o.tg_chat)] = 1;
      if (o.max_chat) карта.max[String(o.max_chat)] = 1;
      const t = String(o.phone || "").replace(/\D/g, "").slice(-10);
      if (t.length === 10) карта.tel[t] = 1;
    });
  } catch (err) { console.log("bc покупатели", err); }
  return карта;
}
// c — строка покупателя (id, tg_chat, max_chat, phone_ok)
function покупал(карта, c) {
  if (!карта) return false;
  if (c.id && карта.cust[c.id]) return true;
  if (c.tg_chat && карта.tg[String(c.tg_chat)]) return true;
  if (c.max_chat && карта.max[String(c.max_chat)]) return true;
  const t = String(c.phone_ok || "").replace(/\D/g, "").slice(-10);
  return !!(t.length === 10 && карта.tel[t]);
}

// ---------- источники ----------
function sources(app) {
  const s = shop.settings(app);
  const count = (sql, bind) => {
    try { const row = new DynamicModel({ n: 0 }); app.db().newQuery(sql).bind(bind || {}).one(row); return row.n; } catch (_) { return 0; }
  };
  // Всех подписчиков и всех покупателей держим в памяти: так в каждом источнике
  // сразу видно и общее число, и сколько там тех, кто ещё ничего не заказывал.
  const купившие = покупатели(app);
  let люди = [];
  try {
    const rows = arrayOf(new DynamicModel({ id: "", tg_chat: "", max_chat: "", phone_ok: "", tg_brands: "", max_brands: "" }));
    app.db().newQuery("SELECT id, tg_chat, max_chat, phone_ok, tg_brands, max_brands FROM customers WHERE tg_chat != '' OR max_chat != ''").all(rows);
    люди = rows;
  } catch (err) { console.log("bc люди", err); }
  // чей это подписчик: метка витрины в списке, а неразобранные — за витриной
  // по умолчанию (её бот стоял в настройках, когда меток ещё не было)
  const счёт = (поле, чат, slug, умолч) => {
    let всего = 0, новых = 0;
    люди.forEach((c) => {
      if (!c[чат]) return;
      const метки = String(c[поле] || "");
      if (!(метки.indexOf("," + slug + ",") >= 0 || (умолч && !метки))) return;
      всего++;
      if (!покупал(купившие, c)) новых++;
    });
    return { count: всего, fresh: новых };
  };
  const out = [];
  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true", "sort", 20, 0); } catch (_) {}

  // У каждой витрины свой бот и свои подписчики. Бот умеет писать только тем,
  // кто сам его запустил, поэтому и источники раздельные: иначе ключом одной
  // витрины мы стучимся к чужим подписчикам и получаем «chat not found».
  // Неразобранных (метки ещё нет) считаем за витрину по умолчанию — её бот
  // стоял в настройках, когда меток не было вовсе.
  const свои = brands.filter((b) => b.get("tg_client_token"));
  const вMax = brands.filter((b) => b.get("max_token"));
  const умолчTg = свои.find((b) => b.get("tg_client_token") === s.get("tg_client_token"));
  const умолчMax = вMax.find((b) => b.get("max_token") === s.get("max_token"));

  свои.forEach((b) => {
    const хвост = (умолчTg && b.id === умолчTg.id) ? " OR tg_brands IS NULL OR tg_brands = ''" : "";
    out.push(Object.assign({ id: "tg:" + b.id, kind: "tg", builtin: true,
      title: b.get("tg_client_bot") ? "@" + b.get("tg_client_bot") : "Бот " + b.get("name"),
      note: "покупатели · " + b.get("name") },
      счёт("tg_brands", "tg_chat", b.get("slug"), !!(умолчTg && b.id === умолчTg.id))));
  });
  вMax.forEach((b) => {
    const хвост = (умолчMax && b.id === умолчMax.id) ? " OR max_brands IS NULL OR max_brands = ''" : "";
    out.push(Object.assign({ id: "mx:" + b.id, kind: "max", builtin: true,
      title: "MAX · " + (b.get("max_bot") || b.get("name")),
      note: "покупатели в MAX · " + b.get("name") },
      счёт("max_brands", "max_chat", b.get("slug"), !!(умолчMax && b.id === умолчMax.id))));
  });

  // Витрин с своими ботами нет — остаётся старый общий источник
  if (!свои.length && s.get("tg_client_token")) {
    out.push(Object.assign({ id: "client", kind: "tg", builtin: true, title: s.get("tg_client_bot") ? "@" + s.get("tg_client_bot") : "Клиентский бот",
      note: "покупатели магазина" }, счёт("tg_brands", "tg_chat", "—", true)));
  }
  if (!вMax.length && s.get("max_token")) {
    out.push(Object.assign({ id: "max", kind: "max", builtin: true, title: s.get("max_bot") ? "MAX · " + s.get("max_bot") : "MAX",
      note: "покупатели в MAX" }, счёт("max_brands", "max_chat", "—", true)));
  }
  app.findRecordsByFilter("bc_bots", "id != ''", "created", 200, 0).forEach((b) => {
    out.push({
      id: b.id, kind: "tg", builtin: false, title: b.get("username") ? "@" + b.get("username") : b.get("title") || "Бот",
      note: b.get("title") || "", active: !!b.get("active"), hello: b.get("hello") || "", error: b.get("error") || "",
      count: count("SELECT COUNT(*) AS n FROM bc_subs WHERE bot = {:b} AND blocked = FALSE", { b: b.id }),
      fresh: count("SELECT COUNT(*) AS n FROM bc_subs s WHERE s.bot = {:b} AND s.blocked = FALSE AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.tg_chat = s.chat)", { b: b.id }),
      blocked: count("SELECT COUNT(*) AS n FROM bc_subs WHERE bot = {:b} AND blocked = TRUE", { b: b.id }),
    });
  });
  return out;
}

// Ключ и способ отправки для источника
function channel(app, s, src) {
  if (src === "client") return s.get("tg_client_token") ? { kind: "tg", token: s.get("tg_client_token") } : null;
  if (src === "max") return s.get("max_token") ? { kind: "max", token: s.get("max_token") } : null;
  if (/^(tg|mx):/.test(src)) {
    let b = null;
    try { b = app.findRecordById("brands", src.slice(3)); } catch (_) { return null; }
    if (src.slice(0, 2) === "tg") return b.get("tg_client_token") ? { kind: "tg", token: b.get("tg_client_token") } : null;
    return b.get("max_token") ? { kind: "max", token: b.get("max_token") } : null;
  }
  try { const b = app.findRecordById("bc_bots", src); return b.get("active") ? { kind: "tg", token: b.get("token"), bot: b } : null; } catch (_) { return null; }
}

// Следующая порция получателей источника после id last
function batch(app, src, last, n, новички) {
  const s = shop.settings(app);
  // «только тем, кто ещё не покупал»: карту покупателей собираем один раз на
  // прогон и просеиваем ею порцию. В фильтре записи это не выразить — связь
  // с заказом идёт по четырём разным полям.
  const просеять = (list, поле) => (новички ? list.filter((c) => !покупал(новички, {
    id: c.id, tg_chat: c.tg_chat, max_chat: c.max_chat, phone_ok: c.phone_ok,
  })) : list);
  // Рекламу шлём только согласившимся, когда выключатель включён. Пока он
  // выключен — как раньше, всем с чатом: иначе рассылка обнулится в тот же
  // день, ведь согласия только начали собираться.
  let согл = "";
  try { if (app.findFirstRecordByFilter("settings", "id != ''").get("ads_only_agreed")) согл = " && ads_ok = true"; } catch (_) {}
  const людьми = (list, чат) => просеять(list.map((c) => ({
    id: c.id, chat: c.get(чат), tg_chat: c.get("tg_chat"), max_chat: c.get("max_chat"), phone_ok: c.get("phone_ok"),
  })));
  if (src === "client") return людьми(app.findRecordsByFilter("customers", `tg_chat != '' && id > {:l}${согл}`, "id", n, 0, { l: last || "" }), "tg_chat");
  if (src === "max") return людьми(app.findRecordsByFilter("customers", `max_chat != '' && id > {:l}${согл}`, "id", n, 0, { l: last || "" }), "max_chat");
  if (/^(tg|mx):/.test(src)) {
    let b = null;
    try { b = app.findRecordById("brands", src.slice(3)); } catch (_) { return []; }
    const тг = src.slice(0, 2) === "tg";
    const поле = тг ? "tg_brands" : "max_brands";
    const чат = тг ? "tg_chat" : "max_chat";
    const свой = тг ? b.get("tg_client_token") === s.get("tg_client_token") : b.get("max_token") === s.get("max_token");
    const ничей = свой ? ` || ${поле} = ''` : "";
    return людьми(app.findRecordsByFilter("customers",
      `${чат} != '' && id > {:l}${согл} && (${поле} ~ {:s}${ничей})`, "id", n, 0,
      { l: last || "", s: "," + b.get("slug") + "," }), чат);
  }
  const подписчики = app.findRecordsByFilter("bc_subs", "bot = {:b} && blocked = false && id > {:l}", "id", n, 0, { b: src, l: last || "" })
    .map((c) => ({ id: c.id, chat: c.get("chat"), tg_chat: c.get("chat"), sub: true }));
  return просеять(подписчики);
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
  // «только новичкам»: карту собираем один раз на прогон, а не на каждую порцию
  if (rec.get("only_new") && !cache.новички) cache.новички = покупатели(app);
  const новички = rec.get("only_new") ? cache.новички : null;
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
    const list = ch ? batch(app, targets[i], last, 25, новички) : [];
    if (!list.length) {
      // Порция могла опустеть после просеивания новичков, а люди дальше есть:
      // двигаем метку по последнему прочитанному и идём дальше, а не считаем
      // источник законченным.
      const сырьё = ch ? batch(app, targets[i], last, 25, null) : [];
      if (сырьё.length) { last = сырьё[сырьё.length - 1].id; save(); continue; }
      i++; last = ""; save(); continue;
    }
    for (const r of list) {
      if (Date.now() >= until) break;
      const res = ch.kind === "max" ? maxSend(ch.token, r.chat, m, cache) : tgSend(ch.token, r.chat, m, cache);
      if (res.ok) sent++; else failed++;
      // Кому дошло — тем и мерить выручку потом. Пишем запросом: тысячи
      // сохранений записями на каждую рассылку — это тысячи лишних хуков.
      if (res.ok) {
        try {
          app.db().newQuery("INSERT INTO bc_sent (id, bc, customer, chat, kind, created) VALUES ({:id}, {:bc}, {:cu}, {:ch}, {:k}, {:t})")
            .bind({ id: $security.randomString(15), bc: rec.id, cu: r.sub ? "" : String(r.id || ""),
              ch: String(r.chat || ""), k: ch.kind, t: new Date().toISOString() }).execute();
        } catch (err) { console.log("bc_sent", err); }
      }
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

module.exports = { clean, plain, sources, channel, message, photoPath, run, poll, tgSend, maxSend, tgCall, pause, покупатели, покупал };
