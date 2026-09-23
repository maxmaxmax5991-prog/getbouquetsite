/// <reference path="../pb_data/types.d.ts" />
// Ссылка на входящий платёж в МоёмСкладе.
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "ms_payment_id", type: "text" }));
  app.save(o);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("ms_payment_id");
  app.save(o);
});
