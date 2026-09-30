/// <reference path="../pb_data/types.d.ts" />
// «Кустовые розы премиум»: не было ростовки 50 см, а у «Грандмас Файнест Кети»
// она в товаре указана — без цены сорт не показать, он и лежал выключенным.
// Цены поставлены ровно посередине между 40 и 70 см, с округлением в привычные
// «…90»: 15 шт — 3990, 51 — 11490, 101 — 19990. Владелец поправит в «Прайсе роз».
migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let tables = [];
  try { tables = JSON.parse(s.getString("price_tables") || "[]"); } catch (_) { tables = []; }
  const t = tables.find((x) => x && x.id === "spray-premium");
  if (!t) { console.log("прайс «Кустовые розы премиум» не найден — пропускаю"); return; }
  t.prices = t.prices || {};
  if (!t.prices["50"]) t.prices["50"] = { "15": 3990, "51": 11490, "101": 19990 };
  s.set("price_tables", JSON.stringify(tables));
  app.save(s);
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let tables = [];
  try { tables = JSON.parse(s.getString("price_tables") || "[]"); } catch (_) { tables = []; }
  const t = tables.find((x) => x && x.id === "spray-premium");
  if (t && t.prices) delete t.prices["50"];
  s.set("price_tables", JSON.stringify(tables));
  app.save(s);
});
