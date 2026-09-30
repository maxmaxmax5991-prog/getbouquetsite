/// <reference path="../pb_data/types.d.ts" />
// Прайс «Кустовые розы пионовидные»: ростовки 40 и 50 см, количества 15/51/101
// — как у премиальных кустовых. Цены поставлены по их прайсу, как рабочая
// заготовка: владелец правит в админке, «Прайс роз».
// На сайте это ничего не меняет, пока прайс не выбран ни у одного товара.
migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let tables = [];
  try { tables = JSON.parse(s.getString("price_tables") || "[]"); } catch (_) { tables = []; }
  if (tables.some((x) => x && x.id === "spray-peony")) return;

  tables.push({
    id: "spray-peony",
    name: "Кустовые розы пионовидные",
    counts: [15, 51, 101],
    prices: {
      "40": { "15": 2990, "51": 8990, "101": 14990 },
      "50": { "15": 3990, "51": 11490, "101": 19990 },
    },
  });
  s.set("price_tables", JSON.stringify(tables));
  app.save(s);
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let tables = [];
  try { tables = JSON.parse(s.getString("price_tables") || "[]"); } catch (_) { tables = []; }
  s.set("price_tables", JSON.stringify(tables.filter((x) => !x || x.id !== "spray-peony")));
  app.save(s);
});
