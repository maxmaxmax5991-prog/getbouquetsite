/// <reference path="../pb_data/types.d.ts" />
// «Цветы ещё в пути»: товар уже продаётся, но самый ранний интервал считается
// не от «сейчас», а от того момента, когда роза будет у нас.
// Время московское, строкой «ГГГГ-ММ-ДД ЧЧ:ММ» — чтобы не путаться с часовыми поясами.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ready_at")) c.fields.add(new Field({ name: "ready_at", type: "text", max: 16 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("ready_at");
  app.save(c);
});
