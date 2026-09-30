/// <reference path="../pb_data/types.d.ts" />
// У кустовых роз размер по умолчанию — самый маленький.
// На карточке в каталоге цена всегда «от», то есть за минимальное количество.
// Если на странице товара сразу выбран размер побольше, цена подскакивает, и
// человек видит не то, на что нажимал. У пионовидных по умолчанию стояло 25.
migrate((app) => {
  const КУСТОВЫЕ = ["spray", "spray-premium", "spray-peony"];
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let tables = [];
  try { tables = JSON.parse(s.getString("price_tables") || "[]"); } catch (_) { tables = []; }
  let changed = false;
  tables.forEach((t) => {
    if (!t || КУСТОВЫЕ.indexOf(t.id) < 0) return;
    const counts = (t.counts || []).map(Number).filter((x) => x > 0);
    if (!counts.length) return;
    const min = Math.min.apply(null, counts);
    if (+t.def_count !== min) { t.def_count = min; changed = true; }
  });
  if (!changed) return;
  s.set("price_tables", JSON.stringify(tables));
  app.save(s);
}, () => {});
