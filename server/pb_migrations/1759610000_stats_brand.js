/// <reference path="../pb_data/types.d.ts" />
// Статистика по витринам: в счётчике посещений и в шагах воронки запоминаем,
// на каком сайте это было. Иначе «Гет Букет» и venikoff.net складывались в одну
// кучу и понять, который из них работает, было нельзя.
// Ключ таблиц пересобираем: один человек может за день зайти на оба сайта,
// и при старом ключе (день + посетитель) второй заход просто терялся.
migrate((app) => {
  const q = (sql) => app.db().newQuery(sql).execute();
  // всё, что накоплено до второй витрины, — это заходы на venikoff.net:
  // «Гет Букет» тогда ещё не существовал
  let old = "";
  try { old = app.findFirstRecordByFilter("brands", "slug = 'venikoff'").id; } catch (_) {}

  q(`CREATE TABLE IF NOT EXISTS visits2 (
    day    TEXT NOT NULL,
    vid    TEXT NOT NULL,
    brand  TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    at     TEXT NOT NULL,
    PRIMARY KEY (day, vid, brand)
  ) WITHOUT ROWID`);
  app.db().newQuery("INSERT OR IGNORE INTO visits2 (day, vid, brand, source, at) SELECT day, vid, {:b}, source, at FROM visits").bind({ b: old }).execute();
  q(`DROP TABLE visits`);
  q(`ALTER TABLE visits2 RENAME TO visits`);
  q(`CREATE INDEX IF NOT EXISTS idx_visits_day ON visits (day)`);

  q(`CREATE TABLE IF NOT EXISTS events2 (
    day   TEXT NOT NULL,
    vid   TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    kind  TEXT NOT NULL,
    ctx   TEXT NOT NULL DEFAULT '',
    at    TEXT NOT NULL,
    PRIMARY KEY (day, vid, brand, kind, ctx)
  ) WITHOUT ROWID`);
  app.db().newQuery("INSERT OR IGNORE INTO events2 (day, vid, brand, kind, ctx, at) SELECT day, vid, {:b}, kind, ctx, at FROM events").bind({ b: old }).execute();
  q(`DROP TABLE events`);
  q(`ALTER TABLE events2 RENAME TO events`);
  q(`CREATE INDEX IF NOT EXISTS idx_events_day ON events (day, kind)`);
}, (app) => {
  // назад — просто убираем колонку витрины, данные остаются
  const q = (sql) => app.db().newQuery(sql).execute();
  q(`ALTER TABLE visits DROP COLUMN brand`);
  q(`ALTER TABLE events DROP COLUMN brand`);
});
