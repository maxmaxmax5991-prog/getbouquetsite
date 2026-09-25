/// <reference path="../pb_data/types.d.ts" />
// Сторож: следит, что боты отвечают, заказы уходят в МойСклад и не задваиваются.
// Отметки «бот жив» пишутся при каждом удачном опросе; состояние тревог —
// в отдельной табличке, чтобы одно и то же не приходило каждые десять минут.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["tg_beat", "tg_beat_client", "max_beat"].forEach((n) => {
    if (!s.fields.getByName(n)) s.fields.add(new Field({ name: n, type: "number" }));
  });
  app.save(s);
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS watchdog_state (
    key   TEXT NOT NULL PRIMARY KEY,
    value TEXT NOT NULL,
    at    TEXT NOT NULL
  ) WITHOUT ROWID`).execute();
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["tg_beat", "tg_beat_client", "max_beat"].forEach((n) => s.fields.removeByName(n));
  app.save(s);
  app.db().newQuery("DROP TABLE IF EXISTS watchdog_state").execute();
});
