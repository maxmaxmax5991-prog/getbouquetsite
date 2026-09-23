/// <reference path="../pb_data/types.d.ts" />
// Отдельный бот для покупателей: вход в кабинет, статусы заказа, фото букета.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "tg_client_token", type: "text" }));
  s.fields.add(new Field({ name: "tg_client_bot", type: "text" }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["tg_client_token", "tg_client_bot"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
});
