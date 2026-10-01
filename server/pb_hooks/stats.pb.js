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
  // с какого сайта зашли — решает домен, а не браузер
  let bid = "";
  try { const b = require(`${__hooks}/lib/brand.js`).byHost($app, e); bid = b ? b.id : ""; } catch (_) {}
  try {
    $app.db().newQuery("INSERT OR IGNORE INTO visits (day, vid, brand, source, at) VALUES ({:d}, {:v}, {:b}, {:s}, {:t})")
      .bind({ d: day, v: vid, b: bid, s: src, t: new Date().toISOString() }).execute();
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

  // ?brand=<id> — только этот сайт; без него считаем оба вместе
  const bid = String(q.get("brand") || "").trim();
  const only = bid ? " AND brand = {:b}" : "";
  const args = bid ? { f: from, t: to, b: bid } : { f: from, t: to };

  const out = { days: [], sources: [], total: 0, brands: [] };
  try {
    const list = arrayOf(new DynamicModel({ day: "", n: 0 }));
    $app.db().newQuery(`SELECT day, COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t}${only} GROUP BY day ORDER BY day`)
      .bind(args).all(list);
    list.forEach((r) => { out.days.push({ day: r.day, n: +r.n }); out.total += +r.n; });
  } catch (err) { console.log("сводка дней", err); }
  try {
    const list = arrayOf(new DynamicModel({ source: "", n: 0 }));
    $app.db().newQuery(`SELECT source, COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t}${only} GROUP BY source ORDER BY n DESC LIMIT 12`)
      .bind(args).all(list);
    list.forEach((r) => out.sources.push({ source: r.source || "прямой заход", n: +r.n }));
  } catch (err) { console.log("сводка источников", err); }
  // разбивка по витринам — чтобы в режиме «вместе» показать оба сайта в одной таблице
  try {
    const list = arrayOf(new DynamicModel({ brand: "", n: 0 }));
    $app.db().newQuery("SELECT brand, COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t} GROUP BY brand")
      .bind({ f: from, t: to }).all(list);
    list.forEach((r) => out.brands.push({ brand: r.brand || "", n: +r.n }));
  } catch (err) { console.log("сводка витрин", err); }
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
  let bid = "";
  try { const br = require(`${__hooks}/lib/brand.js`).byHost($app, e); bid = br ? br.id : ""; } catch (_) {}
  try {
    $app.db().newQuery("INSERT OR IGNORE INTO events (day, vid, brand, kind, ctx, at) VALUES ({:d}, {:v}, {:b}, {:k}, {:c}, {:t})")
      .bind({ d: day, v: vid, b: bid, k: kind, c: String(b.ctx || "").slice(0, 60), t: new Date().toISOString() }).execute();
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
  const bid = String(q.get("brand") || "").trim();
  const only = bid ? " AND brand = {:b}" : "";
  const out = { visits: 0, view: 0, cart: 0, checkout: 0 };
  try {
    const row = new DynamicModel({ n: 0 });
    $app.db().newQuery(`SELECT COUNT(*) as n FROM visits WHERE day >= {:f} AND day <= {:t}${only}`)
      .bind(bid ? { f: from, t: to, b: bid } : { f: from, t: to }).one(row);
    out.visits = +row.n;
  } catch (_) {}
  ["view", "cart", "checkout"].forEach((k) => {
    try {
      const row = new DynamicModel({ n: 0 });
      $app.db().newQuery(`SELECT COUNT(DISTINCT vid) as n FROM events WHERE day >= {:f} AND day <= {:t} AND kind = {:k}${only}`)
        .bind(bid ? { f: from, t: to, k, b: bid } : { f: from, t: to, k }).one(row);
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
  // Индекс рекомендации: доля девяток-десяток минус доля шестёрок и ниже.
  // Считаем только по тем, кто ответил: иначе молчуны утопят любую цифру.
  const оценки = list.map((r) => +r.get("nps") || 0).filter((x) => x > 0);
  const промоутеры = оценки.filter((x) => x >= 9).length;
  const нейтральные = оценки.filter((x) => x === 7 || x === 8).length;
  const критики = оценки.filter((x) => x <= 6).length;
  const nps = оценки.length ? Math.round((промоутеры - критики) * 100 / оценки.length) : null;
  const need = [];
  all.filter((r) => r.get("needs_call") && !r.get("handled")).forEach((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    need.push({
      id: r.id,
      number: o ? o.get("number") : "",
      name: o ? o.get("name") : "",
      phone: o ? o.get("phone") : "",
      nps: +r.get("nps") || 0,
      marks: [+r.get("q_order") || 0, +r.get("q_bouquet") || 0, +r.get("q_delivery") || 0],
      comment: r.get("comment") || "",
      at: r.getString("created"),
    });
  });
  const comments = list.filter((r) => r.get("comment")).slice(0, 20).map((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    return { number: o ? o.get("number") : "", text: r.get("comment"), at: r.getString("created"),
      nps: +r.get("nps") || 0,
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
      nps: +r.get("nps") || 0,
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
    nps, промоутеры, нейтральные, критики,
    nps_avg: оценки.length ? +(оценки.reduce((a, b) => a + b, 0) / оценки.length).toFixed(1) : null,
    answered: оценки.length,
    avg: { order: avg("q_order"), bouquet: avg("q_bouquet"), delivery: avg("q_delivery") },
    fives: list.filter((r) => +r.get("q_order") === 5 && +r.get("q_bouquet") === 5 && +r.get("q_delivery") === 5).length,
    need, comments,
  });
}, $apis.requireAuth("managers"));

// Отдел заботы: кому звонить и что уже сделали. Отдаём всё, что нужно для
// разговора, одним куском — чтобы менеджер не искал заказ по вкладкам.
routerAdd("GET", "/api/shop/care", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head", "manager"])) return e.json(403, { message: "Недостаточно прав." });
  let list = [];
  try { list = $app.findRecordsByFilter("reviews", "needs_call = true", "-created", 200, 0); } catch (_) {}
  const rows = list.map((r) => {
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    return {
      id: r.id,
      оценка: +r.get("nps") || 0,
      отзыв: r.get("comment") || "",
      когда: r.getString("created"),
      взят: !!r.get("handled"),
      кто: r.get("handled_by") || "",
      итог: r.get("handled_note") || "",
      закрыт: r.get("handled_at") || "",
      заказ: o ? {
        number: o.get("number"), total: o.get("total"), date: o.get("date"), interval: o.get("interval"),
        name: o.get("name"), phone: o.get("phone"), recipient: o.get("recipient"),
        address: o.get("address"), delivery_type: o.get("delivery_type"),
        delivery_price: o.get("delivery_price"), note: o.get("note"), delivery_note: o.get("delivery_note"),
        payment_method: o.get("payment_method"), payment_status: o.get("payment_status"),
        status: o.get("status"), items: shop.jget(o, "items") || [],
      } : null,
    };
  });
  return e.json(200, { rows, ждут: rows.filter((x) => !x.взят).length });
}, $apis.requireAuth("managers"));

// Разовая рассылка опроса тем, кто заказывал раньше.
// dry: true — только посчитать, никому ничего не отправляя.
routerAdd("POST", "/api/shop/review-blast", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const b = e.requestInfo().body || {};
  const r = require(`${__hooks}/lib/review.js`).blast($app, Math.max(1, Math.min(1000, +b.limit || 1000)), !!b.dry);
  return e.json(200, r);
}, $apis.requireAuth("managers"));

// Менеджер отметил, что взял недовольного в работу
routerAdd("POST", "/api/shop/reviews", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head", "manager"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  let r;
  try { r = $app.findRecordById("reviews", String(b.id || "")); } catch (_) { return e.json(404, { message: "Не найдено" }); }
  // Исправление оценки: клиент промахнулся по цифре, менеджер поправляет.
  // Отдельная ветка — отметку «прозвонили» при этом не ставим.
  if (b.nps !== undefined) {
    const n = Math.max(1, Math.min(10, Math.round(+b.nps || 0)));
    r.set("nps", n);
    r.set("needs_call", n <= 6);
    if (n > 6) r.set("handled", false);
    $app.save(r);
    return e.json(200, { ok: true, nps: n });
  }
  r.set("handled", true);
  r.set("handled_by", String(b.by || "").slice(0, 120));
  if (b.note !== undefined) r.set("handled_note", String(b.note || "").slice(0, 2000));
  if (!r.get("handled_at")) r.set("handled_at", new Date().toISOString());
  $app.save(r);
  // владельцу — чем закончился разговор: иначе «взял в работу» ничего не говорит
  try {
    const shop2 = require(`${__hooks}/lib/shop.js`);
    const s2 = shop2.settings($app);
    let o = null;
    try { o = $app.findRecordById("orders", r.get("order")); } catch (_) {}
    const n = +r.get("nps") || 0;
    shop2.adminIds(s2).forEach((chat) => shop2.tg(s2.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `✅ Заказ №${o ? o.get("number") : "?"}${n ? ` (оценка ${n} из 10)` : ""} — ${String(b.by || "менеджер")} закрыл(а).${b.note ? `\n«${String(b.note).slice(0, 400)}»` : ""}` }));
  } catch (_) {}
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
