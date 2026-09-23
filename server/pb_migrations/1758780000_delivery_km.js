/// <reference path="../pb_data/types.d.ts" />
// Доставка по километрам от торговой точки + разбор адреса на отдельные поля.
// Расстояние — по прямой между координатами, умноженное на коэффициент (улицы не прямые).
// Координаты адреса берём у геокодера Яндекса; ключ лежит в настройках и в браузер не уходит.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "ymaps_key", type: "text" }));        // ключ геокодера Яндекса
  s.fields.add(new Field({ name: "km_mode", type: "bool" }));          // считать по километрам вместо зон
  s.fields.add(new Field({ name: "km_price", type: "number", min: 0 }));   // ₽ за километр
  s.fields.add(new Field({ name: "km_min", type: "number", min: 0 }));     // минимальная стоимость доставки
  s.fields.add(new Field({ name: "km_factor", type: "number", min: 1 }));  // поправка к расстоянию по прямой
  s.fields.add(new Field({ name: "km_max", type: "number", min: 0 }));     // дальше этого не возим, 0 — без предела
  s.fields.add(new Field({ name: "origin_address", type: "text" }));   // откуда считаем
  s.fields.add(new Field({ name: "origin_lat", type: "number" }));
  s.fields.add(new Field({ name: "origin_lon", type: "number" }));
  app.save(s);

  const o = app.findCollectionByNameOrId("orders");
  [
    { name: "street", type: "text", max: 200 },     // улица (проверена по картам)
    { name: "house", type: "text", max: 20 },       // дом
    { name: "block", type: "text", max: 20 },       // корпус / строение
    { name: "flat", type: "text", max: 20 },        // квартира / офис
    { name: "floor", type: "text", max: 20 },       // этаж
    { name: "intercom", type: "text", max: 40 },    // домофон
    { name: "lat", type: "number" },
    { name: "lon", type: "number" },
    { name: "distance_km", type: "number", min: 0 },
  ].forEach((f) => o.fields.add(new Field(f)));
  app.save(o);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("origin_address", "Москва, Маленковская улица, 14к1");
  rec.set("km_factor", 1.3);
  rec.set("km_price", 0);
  rec.set("km_min", 0);
  rec.set("km_max", 0);
  rec.set("km_mode", false);   // включит владелец, когда впишет ключ и тариф
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["ymaps_key", "km_mode", "km_price", "km_min", "km_factor", "km_max",
    "origin_address", "origin_lat", "origin_lon"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const o = app.findCollectionByNameOrId("orders");
  ["street", "house", "block", "flat", "floor", "intercom", "lat", "lon", "distance_km"]
    .forEach((f) => o.fields.removeByName(f));
  app.save(o);
});
