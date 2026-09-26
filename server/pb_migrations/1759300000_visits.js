/// <reference path="../pb_data/types.d.ts" />
// Свой счётчик посещений: кто заходил, откуда пришёл, во что это превратилось.
// Обычная табличка, а не коллекция: пишем по строке на посетителя в день,
// ключ (день + посетитель) не даёт посчитать одного человека дважды.
// Метрика при этом не мешает — она про другое (вебвизор, реклама, карты кликов).
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS visits (
    day    TEXT NOT NULL,
    vid    TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    at     TEXT NOT NULL,
    PRIMARY KEY (day, vid)
  ) WITHOUT ROWID`).execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day)").execute();

  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("metrika_id")) s.fields.add(new Field({ name: "metrika_id", type: "text", max: 20 }));
  app.save(s);
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS visits").execute();
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("metrika_id");
  app.save(s);
});
