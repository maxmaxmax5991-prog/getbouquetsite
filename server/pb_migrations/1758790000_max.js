/// <reference path="../pb_data/types.d.ts" />
// MAX как второй мессенджер рядом с Телеграмом: статусы заказа и вход в личный кабинет.
// Устройство то же, что у клиентского бота Телеграма, отличается только API.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "max_token", type: "text" }));    // ключ бота MAX
  s.fields.add(new Field({ name: "max_bot", type: "text" }));      // имя бота для ссылки max.ru/<имя>
  s.fields.add(new Field({ name: "max_marker", type: "number" })); // позиция чтения событий
  app.save(s);

  const c = app.findCollectionByNameOrId("customers");
  c.fields.add(new Field({ name: "max_chat", type: "text" }));
  c.fields.add(new Field({ name: "max_name", type: "text" }));
  app.save(c);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "max_chat", type: "text" }));
  app.save(o);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["max_token", "max_bot", "max_marker"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const c = app.findCollectionByNameOrId("customers");
  ["max_chat", "max_name"].forEach((f) => c.fields.removeByName(f));
  app.save(c);
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("max_chat");
  app.save(o);
});
