/// <reference path="../pb_data/types.d.ts" />
// Доставка от МКАД: внутри кольца — одна цена, за кольцом — та же цена плюс
// столько-то рублей за каждый километр от МКАД. Так считает большинство
// цветочных в Москве, и кругами от магазина это не повторить.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "mkad_mode", type: "bool" }));                  // считать от МКАД
  s.fields.add(new Field({ name: "mkad_price", type: "number", min: 0 }));       // цена внутри МКАД
  s.fields.add(new Field({ name: "mkad_km_price", type: "number", min: 0 }));    // ₽ за километр за МКАД
  s.fields.add(new Field({ name: "mkad_max_km", type: "number", min: 0 }));      // дальше не возим, 0 — без предела
  app.save(s);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "mkad_km", type: "number", min: 0 }));   // сколько километров за МКАД
  app.save(o);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("mkad_price", 850);
  rec.set("mkad_km_price", 30);
  rec.set("mkad_max_km", 30);
  rec.set("mkad_mode", false);   // включит владелец, когда проверит цены
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["mkad_mode", "mkad_price", "mkad_km_price", "mkad_max_km"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("mkad_km");
  app.save(o);
});
