/// <reference path="../pb_data/types.d.ts" />
// Рассылки: вкладка «Рассылка» в админке. Подключаем сколько угодно Телеграм-ботов по ключу,
// собираем их подписчиков и шлём всем одно сообщение (текст, фото, кнопка-ссылка).
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное пишем внутри.

// Отправка идёт порциями: задание раз в минуту работает ~50 секунд.
// Замок не даёт двум прогонам слать одно и то же одновременно.
cronAdd("bc-send", "* * * * *", () => {
  const bc = require(`${__hooks}/lib/bc.js`);
  const lock = (sql) => { try { $app.db().newQuery(sql).bind({ t: new Date().toISOString(), old: new Date(Date.now() - 10 * 60000).toISOString() }).execute(); return true; } catch (_) { return false; } };
  let list;
  try { list = $app.findRecordsByFilter("broadcasts", "status = 'queued' || status = 'sending'", "created", 5, 0); } catch (_) { return; }
  if (!list.length) return;
  lock("DELETE FROM order_locks WHERE order_id = 'broadcast' AND kind = 'send' AND at < {:old}");
  if (!lock("INSERT INTO order_locks (order_id, kind, at) VALUES ('broadcast', 'send', {:t})")) return;
  try {
    const until = Date.now() + 50000;
    const cache = {};
    for (const rec of list) {
      if (Date.now() >= until) break;
      try { if (!bc.run($app, rec, until, cache)) break; } catch (err) { console.log("broadcast", rec.id, err); break; }
    }
  } finally {
    try { $app.db().newQuery("DELETE FROM order_locks WHERE order_id = 'broadcast' AND kind = 'send'").execute(); } catch (_) {}
  }
});

// Опрос подключённых ботов: каждый, кто им пишет или жмёт «Старт», становится подписчиком.
// Ботов может быть много, поэтому спрашиваем коротко и по кругу, каждые ~5 секунд.
cronAdd("bc-poll", "* * * * *", () => {
  const bc = require(`${__hooks}/lib/bc.js`);
  const until = Date.now() + 50000;
  while (Date.now() < until) {
    let bots = [];
    try { bots = $app.findRecordsByFilter("bc_bots", "active = true", "created", 200, 0); } catch (_) { return; }
    if (!bots.length) return;
    bots.forEach((b) => { try { bc.poll($app, b); } catch (err) { console.log("bc poll", err); } });
    bc.pause(5000);
  }
});

// Всё для вкладки: источники с числом подписчиков и последние рассылки
routerAdd("GET", "/api/bc", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bc = require(`${__hooks}/lib/bc.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const history = $app.findRecordsByFilter("broadcasts", "id != ''", "-created", 30, 0).map((r) => ({
    id: r.id, text: r.get("text"), photo: r.get("photo") ? shop.fileUrl(r, r.get("photo"), "300x0") : "",
    button_text: r.get("button_text"), button_url: r.get("button_url"), targets: shop.jget(r, "targets") || [],
    status: r.get("status"), total: r.get("total"), sent: r.get("sent"), failed: r.get("failed"),
    only_new: !!r.get("only_new"),
    created: String(r.get("created")), finished: r.get("finished"), author: r.get("author"),
  }));
  const s = shop.settings($app);
  // состояние разбора «кто в каком боте»: сколько ещё без метки
  let без = 0;
  try {
    const row = new DynamicModel({ n: 0 });
    $app.db().newQuery("SELECT COUNT(*) AS n FROM customers WHERE tg_chat != '' AND (tg_brands IS NULL OR tg_brands = '')").one(row);
    без = row.n;
  } catch (_) {}
  return e.json(200, { sources: bc.sources($app), history, admins: shop.adminIds(s).length, site: s.get("site_url") || "",
    probe: { state: s.get("bot_probe") || "", at: s.get("bot_probe_at") || "", left: без } });
}, $apis.requireAuth("managers"));

// Подключить бота по ключу
routerAdd("POST", "/api/bc/bot", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bc = require(`${__hooks}/lib/bc.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const raw = String((e.requestInfo().body || {}).token || "");
  const found = raw.match(/\d{5,}:[A-Za-z0-9_-]{20,}/);
  if (!found) return e.json(400, { message: "Не нашёл ключ. Он выглядит так: 123456789:AAE… — скопируйте целиком из @BotFather." });
  const token = found[0];
  const s = shop.settings($app);
  if (token === s.get("tg_token")) return e.json(400, { message: "Это служебный бот магазина — для рассылок покупателям он не подходит." });
  if (token === s.get("tg_client_token")) return e.json(400, { message: "Этот бот уже подключён — это клиентский бот магазина, он есть в списке." });
  try { $app.findFirstRecordByFilter("bc_bots", "token = {:t}", { t: token }); return e.json(400, { message: "Этот бот уже подключён." }); } catch (_) {}
  const me = bc.tgCall(token, "getMe", {});
  if (!me.ok) return e.json(400, { message: "Телеграм не принял ключ. Проверьте, что скопировали его целиком." });
  const rec = new Record($app.findCollectionByNameOrId("bc_bots"));
  rec.set("token", token);
  rec.set("username", me.result.username || "");
  rec.set("title", me.result.first_name || "");
  rec.set("active", true);
  // если бот подключён к другому сервису, сразу это видно
  const wh = bc.tgCall(token, "getWebhookInfo", {});
  if (wh.ok && wh.result && wh.result.url) rec.set("error", "Бот подключён к другому сервису (webhook). Подписчики не собираются.");
  $app.save(rec);
  return e.json(200, { id: rec.id, username: rec.get("username") });
}, $apis.requireAuth("managers"));

// Настройки бота: вкл/выкл, приветствие, «забрать у другого сервиса»
routerAdd("POST", "/api/bc/bot/{id}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bc = require(`${__hooks}/lib/bc.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  let rec;
  try { rec = $app.findRecordById("bc_bots", e.request.pathValue("id")); } catch (_) { return e.json(404, { message: "Бот не найден." }); }
  const b = e.requestInfo().body || {};
  if (b.active !== undefined) rec.set("active", !!b.active);
  if (b.hello !== undefined) rec.set("hello", String(b.hello).slice(0, 2000));
  if (b.webhook) {
    const r = bc.tgCall(rec.get("token"), "deleteWebhook", { drop_pending_updates: false });
    if (!r.ok) return e.json(400, { message: "Телеграм не дал отключить webhook." });
    rec.set("error", "");
  }
  $app.save(rec);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));

routerAdd("DELETE", "/api/bc/bot/{id}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  try { $app.delete($app.findRecordById("bc_bots", e.request.pathValue("id"))); } catch (_) {}
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));

// Загрузить подписчиков списком: ID из другого сервиса рассылок (Salebot, BotHelp и т.п.)
routerAdd("POST", "/api/bc/bot/{id}/import", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  let bot;
  try { bot = $app.findRecordById("bc_bots", e.request.pathValue("id")); } catch (_) { return e.json(404, { message: "Бот не найден." }); }
  const ids = [...new Set(String((e.requestInfo().body || {}).ids || "").match(/\b\d{5,15}\b/g) || [])].slice(0, 100000);
  if (!ids.length) return e.json(400, { message: "Не нашёл ни одного ID. Нужны числа, например 512345678." });
  let added = 0;
  const col = $app.findCollectionByNameOrId("bc_subs");
  ids.forEach((id) => {
    try { $app.findFirstRecordByFilter("bc_subs", "bot = {:b} && chat = {:c}", { b: bot.id, c: id }); return; } catch (_) {}
    const r = new Record(col);
    r.set("bot", bot.id); r.set("chat", id);
    try { $app.save(r); added++; } catch (_) {}
  });
  return e.json(200, { added, total: ids.length });
}, $apis.requireAuth("managers"));

// Сколько рассылка принесла. Два счёта: по метке в ссылке (кто нажал кнопку и
// заказал) и по получателям (кто получил и заказал потом как угодно, хоть по
// телефону). Отменённые заказы не считаем.
routerAdd("GET", "/api/bc/money/{id}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  let rec;
  try { rec = $app.findRecordById("broadcasts", e.request.pathValue("id")); } catch (_) { return e.json(404, { message: "Рассылка не найдена." }); }
  const дней = Math.min(60, Math.max(1, parseInt(e.request.url.query().get("days"), 10) || 7));
  const от = String(rec.get("created")).replace(" ", "T").slice(0, 19) + "Z";
  const до = new Date(new Date(от).getTime() + дней * 86400000).toISOString();
  const одно = (sql, bind) => {
    try {
      const row = new DynamicModel({ n: 0, s: 0.0 });
      $app.db().newQuery(sql).bind(bind || {}).one(row);
      return { n: row.n, sum: Math.round(row.s) };
    } catch (err) { console.log("bc money", err); return { n: 0, sum: 0 }; }
  };
  const поСсылке = одно(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS s FROM orders
      WHERE source = {:src} AND status != 'cancelled' AND created >= {:от} AND created <= {:до}`,
    { src: "bc" + rec.id, от, до });
  const поПолучателям = одно(
    `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS s FROM orders o
      WHERE o.status != 'cancelled' AND o.created >= {:от} AND o.created <= {:до} AND EXISTS (
        SELECT 1 FROM bc_sent b WHERE b.bc = {:bc} AND (
          (b.customer != '' AND o.customer = b.customer)
          OR (b.kind = 'tg' AND b.chat != '' AND o.tg_chat = b.chat)
          OR (b.kind = 'max' AND b.chat != '' AND o.max_chat = b.chat)))`,
    { bc: rec.id, от, до });
  return e.json(200, { days: дней, from: от, to: до, link: поСсылке, people: поПолучателям, sent: rec.get("sent") || 0 });
}, $apis.requireAuth("managers"));

// Новая рассылка (или проверка себе: test=1). Форма с файлом, поэтому multipart.
routerAdd("POST", "/api/bc/send", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bc = require(`${__hooks}/lib/bc.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  e.request.parseMultipartForm(25 << 20);
  const form = e.request.multipartForm;
  const val = (n) => { const v = form.value[n]; return v && v.length ? String(v[0]).trim() : ""; };
  const text = val("text").slice(0, 4096);
  const photo = (form.file["photo"] || []).slice(0, 1).map((fh) => $filesystem.fileFromMultipart(fh));
  if (!text && !photo.length) return e.json(400, { message: "Напишите текст или добавьте фото." });
  const btnText = val("button_text").slice(0, 60), btnUrl = val("button_url").slice(0, 1000);
  if ((btnText || btnUrl) && !(btnText && /^https?:\/\/\S+$/.test(btnUrl))) return e.json(400, { message: "У кнопки нужны и надпись, и ссылка, начинающаяся с https://" });
  let targets = [];
  try { targets = JSON.parse(val("targets") || "[]"); } catch (_) {}
  const known = bc.sources($app);
  targets = targets.filter((t) => known.some((k) => k.id === t && (k.builtin || k.active)));
  if (!targets.length) return e.json(400, { message: "Отметьте хотя бы одного бота." });
  const test = val("test") === "1";
  const толькоНовым = val("only_new") === "1";

  const rec = new Record($app.findCollectionByNameOrId("broadcasts"));
  rec.set("text", text);
  if (photo.length) rec.set("photo", photo[0]);
  rec.set("button_text", btnText); rec.set("button_url", btnUrl);
  rec.set("targets", targets);
  rec.set("only_new", толькоНовым);
  rec.set("status", test ? "stopped" : "queued");
  rec.set("total", known.filter((k) => targets.indexOf(k.id) >= 0)
    .reduce((a, k) => a + ((толькоНовым ? k.fresh : k.count) || 0), 0));
  rec.set("sent", 0); rec.set("failed", 0);
  try { rec.set("author", e.auth.get("email")); } catch (_) {}
  $app.save(rec);

  // Метка в ссылке кнопки: сайт запоминает utm_source и кладёт его в заказ, —
  // так потом видно, сколько рассылка принесла деньгами. Ставим только на свои
  // домены и только если метки там ещё нет: чужую ссылку трогать нельзя.
  if (btnUrl && !/[?&]utm_source=/i.test(btnUrl)) {
    const хост = (String(btnUrl).match(/^https?:\/\/([^\/?#]+)/i) || ["", ""])[1].replace(/^www\./, "").toLowerCase();
    const свои = [];
    try { $app.findRecordsByFilter("brands", "domain != ''", "sort", 20, 0).forEach((b) => свои.push(String(b.get("domain")).replace(/^www\./, "").toLowerCase())); } catch (_) {}
    const изНастроек = (String(shop.settings($app).get("site_url") || "").match(/^https?:\/\/([^\/?#]+)/i) || ["", ""])[1].replace(/^www\./, "").toLowerCase();
    if (изНастроек) свои.push(изНастроек);
    if (хост && свои.indexOf(хост) >= 0) {
      rec.set("button_url", btnUrl + (btnUrl.indexOf("?") >= 0 ? "&" : "?") + "utm_source=bc" + rec.id);
      $app.save(rec);
    }
  }
  if (!test) return e.json(200, { id: rec.id, total: rec.get("total") });

  // Проверка: шлём себе — тем, кто записан в «Кому писать в Телеграм» (Настройки).
  // Через чужого бота дойдёт, только если вы хоть раз нажали у него «Старт».
  const s = shop.settings($app);
  const admins = shop.bossIds(s);   // проверку шлём хозяину, а не всем наблюдателям
  const m = bc.message($app, rec);
  const cache = {};
  const out = [];
  targets.forEach((t) => {
    const k = known.find((x) => x.id === t);
    const ch = bc.channel($app, s, t);
    if (!ch) return;
    if (ch.kind === "max") return out.push({ bot: k.title, ok: false, error: "в MAX проверка не отправляется — нет вашего номера в MAX" });
    if (!admins.length) return out.push({ bot: k.title, ok: false, error: "не указано, кому писать (Настройки → Телеграм)" });
    const r = bc.tgSend(ch.token, admins[0], m, cache);
    out.push({ bot: k.title, ok: r.ok, error: r.ok ? "" : (r.gone ? "нажмите «Старт» у этого бота в Телеграме и повторите" : r.error) });
  });
  try { $app.delete(rec); } catch (_) {}
  return e.json(200, { test: out });
}, $apis.requireAuth("managers"));

routerAdd("POST", "/api/bc/stop/{id}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  try {
    $app.db().newQuery("UPDATE broadcasts SET status = 'stopped', finished = {:t} WHERE id = {:id} AND status IN ('queued', 'sending')")
      .bind({ id: e.request.pathValue("id"), t: new Date().toISOString() }).execute();
  } catch (_) {}
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
