/// <reference path="../pb_data/types.d.ts" />
// Свой адрес самовывоза у витрины. Точка выдачи одна на оба бренда,
// но называться для покупателя может по-разному.
migrate((app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["pickup_address", "pickup_hours"].forEach((n) => {
    if (!c.fields.getByName(n)) c.fields.add(new Field({ name: n, type: "text", max: 200 }));
  });
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["pickup_address", "pickup_hours"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
