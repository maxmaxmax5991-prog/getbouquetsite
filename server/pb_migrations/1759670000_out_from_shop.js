/// <reference path="../pb_data/types.d.ts" />
// За МКАД считаем от МАГАЗИНА, а не от кольца.
// Магазин на северо-востоке, поэтому расстояние до МКАД ничего не говорит о работе
// курьера: Королёву насчитывалось 8 км за кольцом и 1390 ₽, а Видному — 2,9 км и
// 1030 ₽, хотя до Королёва 18 км, а до Видного 27 через весь город. Цена шла
// наоборот пробегу. Теперь: база плюс за каждый километр дальше mkad_km_from
// от магазина.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  // с какого километра ОТ МАГАЗИНА начинаем добирать за километры
  if (!c.fields.getByName("mkad_km_from")) c.fields.add(new Field({ name: "mkad_km_from", type: "number", min: 0 }));
  // предел тоже от магазина: «10 км от МКАД» пропускало Видное и резало Королёва
  if (!c.fields.getByName("max_km")) c.fields.add(new Field({ name: "max_km", type: "number", min: 0 }));
  app.save(c);

  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("mkad_out_base", 850);
  s.set("mkad_km_price", 55);
  s.set("mkad_km_from", 15);
  s.set("max_km", 35);
  app.save(s);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  ["mkad_km_from", "max_km"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
