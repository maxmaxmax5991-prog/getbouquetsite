/// <reference path="../pb_data/types.d.ts" />
// Разрешённые группы: бот сидит в чате флористов и забирает оттуда фото,
// подписанные номером заказа. Чужую группу не слушаем — только те, что разрешил владелец.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("tg_groups")) s.fields.add(new Field({ name: "tg_groups", type: "text", max: 500 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("tg_groups");
  app.save(s);
});
