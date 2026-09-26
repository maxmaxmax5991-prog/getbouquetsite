/// <reference path="../pb_data/types.d.ts" />
// Чат собирает все каналы: сайт, клиентский бот Телеграма и MAX.
// last_from — куда отвечать, via — откуда пришло сообщение (видно менеджеру).
migrate((app) => {
  const c = app.findCollectionByNameOrId("chats");
  if (!c.fields.getByName("last_from")) c.fields.add(new Field({ name: "last_from", type: "select", maxSelect: 1, values: ["site", "tg", "max"] }));
  app.save(c);
  const m = app.findCollectionByNameOrId("chat_messages");
  if (!m.fields.getByName("via")) m.fields.add(new Field({ name: "via", type: "select", maxSelect: 1, values: ["site", "tg", "max"] }));
  app.save(m);
}, (app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.removeByName("last_from"); app.save(c);
  const m = app.findCollectionByNameOrId("chat_messages");
  m.fields.removeByName("via"); app.save(m);
});
