/// <reference path="../pb_data/types.d.ts" />
// Интервалы отдельно для доставки и для самовывоза.
migrate((app) => {
  const i = app.findCollectionByNameOrId("delivery_intervals");
  i.fields.add(new Field({ name: "kind", type: "select", maxSelect: 1, values: ["both", "delivery", "pickup"] }));
  app.save(i);
  app.db().newQuery("UPDATE delivery_intervals SET kind = 'both' WHERE kind = '' OR kind IS NULL").execute();
}, (app) => {
  const i = app.findCollectionByNameOrId("delivery_intervals");
  i.fields.removeByName("kind");
  app.save(i);
});
