/// <reference path="../pb_data/types.d.ts" />
// Покупатель может подписаться на статусы заказа в Телеграме.
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "tg_code", type: "text" }));   // код для ссылки на бота
  o.fields.add(new Field({ name: "tg_chat", type: "text" }));   // чат покупателя
  app.save(o);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "tg_bot", type: "text" }));    // имя бота, например newbouquet_bot
  app.save(s);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  ["tg_code", "tg_chat"].forEach((f) => o.fields.removeByName(f));
  app.save(o);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("tg_bot");
  app.save(s);
});
