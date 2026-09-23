/// <reference path="../pb_data/types.d.ts" />
// Клиент подтверждает фото букета.
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "photo_status", type: "select", maxSelect: 1, values: ["waiting", "approved", "rework"] }));
  o.fields.add(new Field({ name: "photo_comment", type: "text", max: 1000 }));
  app.save(o);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  ["photo_status", "photo_comment"].forEach((f) => o.fields.removeByName(f));
  app.save(o);
});
