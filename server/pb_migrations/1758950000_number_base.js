/// <reference path="../pb_data/types.d.ts" />
// С какого номера начинать заказы, когда в базе их нет.
// Пригодилось после чистки истории: номера 1001–1010 уже ушли в МойСклад,
// и начинать заново с 1001 значит получить там два заказа с одним номером.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "number_base", type: "number", min: 1 }));
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("number_base", 2001);
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("number_base");
  app.save(s);
});
