/// <reference path="../pb_data/types.d.ts" />
// Ключ IndexNow: им мы подтверждаем поисковику, что домен наш, когда сами
// сообщаем об изменившихся страницах. Файл с ключом отдаётся по адресу
// https://домен/<ключ>.txt.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("indexnow_key")) s.fields.add(new Field({ name: "indexnow_key", type: "text", max: 80 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("indexnow_key");
  app.save(s);
});
