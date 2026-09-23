/// <reference path="../pb_data/types.d.ts" />
// Несколько прайсов «длина × количество»: одноголовые, кустовые и любые другие.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "price_tables", type: "json" }));
  app.save(s);

  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "price_table", type: "text" }));   // id прайса из settings.price_tables
  app.save(p);

  // старый прайс roses_prices становится первой таблицей «Одноголовые розы»
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  let old = {};
  try { old = JSON.parse(rec.getString("rose_prices") || "{}"); } catch (_) {}
  rec.set("price_tables", [
    { id: "single", name: "Одноголовые розы", counts: [25, 51, 101], prices: old },
    { id: "spray", name: "Кустовые розы", counts: [9, 15, 25, 51], prices: {} },
  ]);
  app.save(rec);

  app.findRecordsByFilter("products", "lengths != null && lengths != ''", "", 500, 0)
    .forEach((x) => { x.set("price_table", "single"); app.save(x); });
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("price_tables");
  app.save(s);
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("price_table");
  app.save(p);
});
