/// <reference path="../pb_data/types.d.ts" />
// Зоны доставки — круги от магазина. У каждой зоны свой радиус в километрах и своя цена.
// Адрес покупателя проверяется по картам, считается расстояние от точки, и берётся
// первая зона, в чей круг адрес попал. Цена за километр больше не используется.
// Плюс подъезд в адресе — курьеру он нужен не меньше квартиры.
migrate((app) => {
  const z = app.findCollectionByNameOrId("delivery_zones");
  z.fields.add(new Field({ name: "radius_km", type: "number", min: 0 }));   // до скольких км от магазина
  app.save(z);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "entrance", type: "text", max: 20 }));
  app.save(o);

  // Ставим примерные радиусы, чтобы режим заработал сразу; владелец поправит в админке.
  const guess = [28, 35, 45];
  app.findRecordsByFilter("delivery_zones", "id != ''", "sort", 100, 0).forEach((rec, i) => {
    if (+rec.get("radius_km") > 0) return;
    rec.set("radius_km", guess[i] || (guess[guess.length - 1] + (i - guess.length + 1) * 10));
    app.save(rec);
  });
}, (app) => {
  const z = app.findCollectionByNameOrId("delivery_zones");
  z.fields.removeByName("radius_km");
  app.save(z);
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("entrance");
  app.save(o);
});
