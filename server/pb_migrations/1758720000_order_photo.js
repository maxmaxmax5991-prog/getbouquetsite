/// <reference path="../pb_data/types.d.ts" />
// Фото готового букета: отправляем клиенту и храним у заказа.
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "photo_file_id", type: "text" }));   // фото в Телеграме
  app.save(o);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("photo_file_id");
  app.save(o);
});
