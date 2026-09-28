/// <reference path="../pb_data/types.d.ts" />
// Время сборки для экспресс-букетов: они уже собраны, нужно только упаковать и отдать.
// И большие букеты собираются дольше — 201 роза за 65 минут не получится.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("prep_express")) s.fields.add(new Field({ name: "prep_express", type: "number", min: 0 }));
  app.save(s);
  app.db().newQuery("UPDATE settings SET prep_express = 20 WHERE prep_express IS NULL OR prep_express = 0").execute();
  app.db().newQuery("UPDATE settings SET prep_min_big = 75").execute();
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("prep_express");
  app.save(s);
});
