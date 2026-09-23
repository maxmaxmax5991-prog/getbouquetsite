/// <reference path="../pb_data/types.d.ts" />
// Самовывоз: оплата при получении возможна только при самовывозе, доставка — только картой.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "pickup", type: "bool" }));            // самовывоз включён
  s.fields.add(new Field({ name: "pickup_address", type: "text" }));    // адрес пункта самовывоза
  s.fields.add(new Field({ name: "pickup_hours", type: "text" }));      // часы работы
  app.save(s);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "delivery_type", type: "select", maxSelect: 1, values: ["delivery", "pickup"] }));
  app.save(o);

  app.db().newQuery("UPDATE orders SET delivery_type = 'delivery' WHERE delivery_type = '' OR delivery_type IS NULL").execute();
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["pickup", "pickup_address", "pickup_hours"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("delivery_type");
  app.save(o);
});
