/// <reference path="../pb_data/types.d.ts" />
// Табло ошибок. Одинаковые складываем в одну строку со счётчиком — иначе одна
// повторяющаяся беда забьёт весь список и заслонит редкие, но важные.
// Обычная табличка, а не коллекция: пишем из хуков часто и без лишних правил.
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS errors (
    key      TEXT NOT NULL PRIMARY KEY,
    place    TEXT NOT NULL,
    text     TEXT NOT NULL,
    ctx      TEXT NOT NULL DEFAULT '',
    count    INTEGER NOT NULL DEFAULT 1,
    first_at TEXT NOT NULL,
    last_at  TEXT NOT NULL,
    fixed    INTEGER NOT NULL DEFAULT 0
  ) WITHOUT ROWID`).execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_errors_last ON errors (fixed, last_at)").execute();
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS errors").execute();
});
