/// <reference path="../pb_data/types.d.ts" />
// Как зовут флористов по-человечески. Имя из Телеграма бывает в одну букву
// («ми») или вовсе чужое, а в отчёте «кто сколько букетов сделал» оно главное.
// Карта «id в Телеграме → имя», правится в админке на вкладке «Команда».
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("florist_names")) s.fields.add(new Field({ name: "florist_names", type: "json", maxSize: 20000 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("florist_names");
  app.save(s);
});
