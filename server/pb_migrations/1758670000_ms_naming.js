/// <reference path="../pb_data/types.d.ts" />
// Товары в МоёмСкладе создаются с приставкой и размером: «ЛФ Пич Аваланж 60см 51шт».
// Каждый размер — отдельный товар, поэтому коды храним по размерам.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "ms_prefix", type: "text" }));
  app.save(s);
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("ms_prefix", "ЛФ-");
  app.save(rec);

  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "ms_ids", type: "json" }));   // { "60-51": "id-в-МоёмСкладе", ... }
  app.save(p);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("ms_prefix");
  app.save(s);
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("ms_ids");
  app.save(p);
});
