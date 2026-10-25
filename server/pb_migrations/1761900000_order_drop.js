/// <reference path="../pb_data/types.d.ts" />
// Связь заказа с местом в очереди дропа: по ней ставим «забрал» и видно,
// что заказ пришёл из дропа, а не из каталога.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  if (!c.fields.getByName("drop_q")) c.fields.add(new Field({ name: "drop_q", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("drop_q");
  app.save(c);
});
