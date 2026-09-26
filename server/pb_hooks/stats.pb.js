/// <reference path="../pb_data/types.d.ts" />
// Счётчик посещений и сводка для админки.
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное внутри.

// Сайт отмечается один раз за заход
routerAdd("POST", "/api/shop/hit", (e) => {
  const b = e.requestInfo().body || {};
  const vid = String(b.vid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  if (vid.length < 8) return e.json(200, { ok: true });
  const src = String(b.source || "прямой заход").slice(0, 60);
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);   // день по Москве
  try {
    $app.db().newQuery("INSERT OR IGNORE INTO visits (day, vid, source, at) VALUES ({:d}, {:v}, {:s}, {:t})")
      .bind({ d: day, v: vid, s: src, t: new Date().toISOString() }).execute();
  } catch (err) { console.log("счётчик", err); }
  return e.json(200, { ok: true });
});

// Сводка: посетители по дням, откуда пришли, конверсия в заказы
routerAdd("GET", "/api/shop/stats-visits", (e) => {
  // Можно спросить «с какого по какой день» (дни московские) или просто «за N дней»
  const q = e.request.url.query();
  const days = Math.min(365, Math.max(1, +q.get("days") || 7));
  const from = String(q.get("from") || "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? q.get("from")
    : new Date(Date.now() + 3 * 3600 * 1000 - (days - 1) * 864e5).toISOString().slice(0, 10);
  const to = String(q.get("to") || "").match(/^\d{4}-\d{2}-\d{2}$/)
    ? q.get("to")
    : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  const out = { days: [], sources: [], total: 0 };
  try {
    const list = arrayOf(new DynamicModel({ day: "", n: 0 }));
    $app.db().newQuery("SELECT day, COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t} GROUP BY day ORDER BY day")
      .bind({ f: from, t: to }).all(list);
    list.forEach((r) => { out.days.push({ day: r.day, n: +r.n }); out.total += +r.n; });
  } catch (err) { console.log("сводка дней", err); }
  try {
    const list = arrayOf(new DynamicModel({ source: "", n: 0 }));
    $app.db().newQuery("SELECT source, COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t} GROUP BY source ORDER BY n DESC LIMIT 12")
      .bind({ f: from, t: to }).all(list);
    list.forEach((r) => out.sources.push({ source: r.source || "прямой заход", n: +r.n }));
  } catch (err) { console.log("сводка источников", err); }
  return e.json(200, out);
}, $apis.requireAuth("managers"));

// Шаги посетителя: открыл карточку, положил в корзину, начал оформлять.
// Одна отметка на посетителя в день на каждый шаг — считаем людей, а не клики.
routerAdd("POST", "/api/shop/ev", (e) => {
  const b = e.requestInfo().body || {};
  const vid = String(b.vid || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40);
  const kind = String(b.kind || "").slice(0, 20);
  if (vid.length < 8 || ["view", "cart", "checkout"].indexOf(kind) < 0) return e.json(200, { ok: true });
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  try {
    $app.db().newQuery("INSERT OR IGNORE INTO events (day, vid, kind, ctx, at) VALUES ({:d}, {:v}, {:k}, {:c}, {:t})")
      .bind({ d: day, v: vid, k: kind, c: String(b.ctx || "").slice(0, 60), t: new Date().toISOString() }).execute();
  } catch (err) { console.log("событие", err); }
  return e.json(200, { ok: true });
});

// Воронка и брошенные корзины за отрезок
routerAdd("GET", "/api/shop/funnel", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const from = String(q.get("from") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("from") : new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const to = String(q.get("to") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("to") : from;
  const out = { visits: 0, view: 0, cart: 0, checkout: 0 };
  try {
    const row = new DynamicModel({ n: 0 });
    $app.db().newQuery("SELECT COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t}").bind({ f: from, t: to }).one(row);
    out.visits = +row.n;
  } catch (_) {}
  ["view", "cart", "checkout"].forEach((k) => {
    try {
      const row = new DynamicModel({ n: 0 });
      $app.db().newQuery("SELECT COUNT(DISTINCT vid) as n FROM events WHERE day >= {:f} AND day <= {:t} AND kind = {:k}")
        .bind({ f: from, t: to, k }).one(row);
      out[k] = +row.n;
    } catch (_) {}
  });
  return e.json(200, out);
}, $apis.requireAuth("managers"));

// Оценки после вручения: средние по трём категориям и кто ждёт звонка
routerAdd("GET", "/api/shop/reviews", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  // Оценки за выбранный период — как и всё остальное на вкладке статистики.
  // «Ждут звонка» при этом показываем все: висящий недовольный клиент важнее периода.
  const q = e.request.url.query();
  const fromU = String(q.get("from") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? `${q.get("from")} 00:00:00` : "";
  const toU = String(q.get("to") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? `${q.get("to")} 23:59:59` : "";
  const all = $app.findRecordsByFilter("reviews", "id != ''", "-created", 500, 0);
  const list = (fromU && toU)
    ? all.filter((r) => { const c = r.getString("created"); return c >= fromU && c <= toU; })
    : all;
  const avg = (f) => {
    const v = list.map((r) => +r.get(f) || 0).filter((x) => x > 0);
    return v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : null;
  };
  const need = [];
  all.filter((r) => r.get("needs_call") && !r.get("handled")).forEach((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    need.push({
      id: r.id,
      number: o ? o.get("number") : "",
      name: o ? o.get("name") : "",
      phone: o ? o.get("phone") : "",
      marks: [+r.get("q_order") || 0, +r.get("q_bouquet") || 0, +r.get("q_delivery") || 0],
      comment: r.get("comment") || "",
      at: r.getString("created"),
    });
  });
  const comments = list.filter((r) => r.get("comment")).slice(0, 20).map((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    return { number: o ? o.get("number") : "", text: r.get("comment"), at: r.getString("created"),
      marks: [+r.get("q_order") || 0, +r.get("q_bouquet") || 0, +r.get("q_delivery") || 0] };
  });
  // Полный список — владелец хочет видеть каждую оценку, а не только средние
  const rows = all.map((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    return {
      id: r.id,
      number: o ? o.get("number") : "",
      name: o ? o.get("name") : "",
      phone: o ? o.get("phone") : "",
      marks: [+r.get("q_order") || 0, +r.get("q_bouquet") || 0, +r.get("q_delivery") || 0],
      comment: r.get("comment") || "",
      step: r.get("step") || "",
      needs_call: !!r.get("needs_call"),
      handled: !!r.get("handled"),
      at: r.getString("created"),
    };
  });
  return e.json(200, {
    rows,
    total: list.length,
    answered: list.filter((r) => +r.get("q_delivery") > 0).length,
    avg: { order: avg("q_order"), bouquet: avg("q_bouquet"), delivery: avg("q_delivery") },
    fives: list.filter((r) => +r.get("q_order") === 5 && +r.get("q_bouquet") === 5 && +r.get("q_delivery") === 5).length,
    need, comments,
  });
}, $apis.requireAuth("managers"));

// Менеджер отметил, что взял недовольного в работу
routerAdd("POST", "/api/shop/reviews", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head", "manager"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  let r;
  try { r = $app.findRecordById("reviews", String(b.id || "")); } catch (_) { return e.json(404, { message: "Не найдено" }); }
  r.set("handled", true);
  r.set("handled_by", String(b.by || "").slice(0, 120));
  $app.save(r);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
