/// <reference path="../pb_data/types.d.ts" />
// «Мисс Бомбастик выведи в топ» — просьба владельца 06.11.2026.
// Закреплённые идут первыми в плитке, порядок в списке = порядок на витрине,
// поэтому Мисс Бомбастик встаёт перед Кейтлин. Дальше это правится в админке
// (Настройки → Витрины → плитка), миграция только ставит начальное состояние.
migrate((app) => {
  const МИСС = "0puvuvxw8gr58lz";                 // Мисс Бомбастик, пионовидная
  try {
    const b = app.findFirstRecordByFilter("brands", "slug = {:s}", { s: "venikoff" });
    let было = [];
    try { было = JSON.parse(b.getString("tile_pins") || "[]") || []; } catch (_) {}
    if (!Array.isArray(было)) было = [];
    const стало = [МИСС].concat(было.filter((x) => String(x) !== МИСС));
    b.set("tile_pins", стало);
    app.save(b);
    console.log("плитка venikoff.net: закреплено", stale(стало));
  } catch (err) { console.log("не закрепил Мисс Бомбастик", err); }
  function stale(a) { return a.join(", "); }
}, (app) => {
  try {
    const b = app.findFirstRecordByFilter("brands", "slug = {:s}", { s: "venikoff" });
    let было = [];
    try { было = JSON.parse(b.getString("tile_pins") || "[]") || []; } catch (_) {}
    b.set("tile_pins", (Array.isArray(было) ? было : []).filter((x) => String(x) !== "0puvuvxw8gr58lz"));
    app.save(b);
  } catch (_) {}
});
