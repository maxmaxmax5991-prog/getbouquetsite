/// <reference path="../pb_data/types.d.ts" />
// У Яндекса геокодер и подсказки — разные сервисы с разными ключами.
// Отдельное поле для ключа подсказок; пусто — пробуем ключом геокодера.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "ymaps_suggest_key", type: "text" }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("ymaps_suggest_key");
  app.save(s);
});
