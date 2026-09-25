/// <reference path="../pb_data/types.d.ts" />
// Замок «этот заказ уже отправляется в МойСклад».
//
// Проверка `if (o.get("ms_id"))` читает копию заказа в памяти: две одновременные
// проверки оплаты обе видели пустое поле и создавали в МоёмСкладе по заказу —
// 25.09 так задвоились №3014 и №3020, а МойСклад потом не давал их сохранить
// («нарушено ограничение уникальности параметра name»).
// Первичный ключ (заказ + действие) не даёт вставить вторую запись.
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS order_locks (
    order_id TEXT NOT NULL,
    kind     TEXT NOT NULL,
    at       TEXT NOT NULL,
    PRIMARY KEY (order_id, kind)
  ) WITHOUT ROWID`).execute();
  // у заказов, уже уехавших в МойСклад, замок считаем взятым
  app.db().newQuery(`INSERT OR IGNORE INTO order_locks (order_id, kind, at)
    SELECT id, 'push', datetime('now') FROM orders WHERE ms_id != ''`).execute();
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS order_locks").execute();
});
