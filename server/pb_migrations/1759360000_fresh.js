/// <reference path="../pb_data/types.d.ts" />
// «Сегодня приехал с теплицы»: день завоза у сорта.
// Храним дату, а не галочку, — иначе завтра плашка будет врать.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("fresh_date")) c.fields.add(new Field({ name: "fresh_date", type: "text", max: 10 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("fresh_date");
  app.save(c);
});
