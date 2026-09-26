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
  const days = Math.min(365, Math.max(1, +e.request.url.query().get("days") || 7));
  const from = new Date(Date.now() + 3 * 3600 * 1000 - (days - 1) * 864e5).toISOString().slice(0, 10);

  const out = { days: [], sources: [], total: 0 };
  try {
    const list = arrayOf(new DynamicModel({ day: "", n: 0 }));
    $app.db().newQuery("SELECT day, COUNT(*) as n FROM visits WHERE day >= {:f} GROUP BY day ORDER BY day")
      .bind({ f: from }).all(list);
    list.forEach((r) => { out.days.push({ day: r.day, n: +r.n }); out.total += +r.n; });
  } catch (err) { console.log("сводка дней", err); }
  try {
    const list = arrayOf(new DynamicModel({ source: "", n: 0 }));
    $app.db().newQuery("SELECT source, COUNT(*) as n FROM visits WHERE day >= {:f} GROUP BY source ORDER BY n DESC LIMIT 12")
      .bind({ f: from }).all(list);
    list.forEach((r) => out.sources.push({ source: r.source || "прямой заход", n: +r.n }));
  } catch (err) { console.log("сводка источников", err); }
  return e.json(200, out);
}, $apis.requireAuth("managers"));
