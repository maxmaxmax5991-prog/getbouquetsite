/// <reference path="../pb_data/types.d.ts" />
// Своя прибавка к сборке для самовывоза. Курьера ждать не надо, поэтому в запару
// самовывоз можно сдвигать меньше, чем доставку. Пусто — сдвигается наравне.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("load_extra_pickup")) c.fields.add(new Field({ name: "load_extra_pickup", type: "number", min: 0, max: 600 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("load_extra_pickup");
  app.save(c);
});
