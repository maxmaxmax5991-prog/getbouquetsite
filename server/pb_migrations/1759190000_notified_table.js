/// <reference path="../pb_data/types.d.ts" />
// Отдельная табличка «об этом статусе покупателю уже сообщили».
//
// Раньше отметка лежала полем в самом заказе, и её стирало: хук пишет отметку
// запросом, а рядом идущий код (МойСклад, оплата) сохраняет заказ целиком из копии,
// прочитанной ДО этого, и возвращает пустое значение обратно. Каждое такое
// сохранение снова выглядело как «о статусе ещё не сообщали» — покупателю
// прилетало 6 одинаковых сообщений подряд.
//
// Здесь же первичный ключ (заказ + статус) не даёт вставить вторую запись,
// поэтому сообщение уходит ровно один раз, что бы ни делали соседние сохранения.
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS order_notified (
    order_id TEXT NOT NULL,
    status   TEXT NOT NULL,
    at       TEXT NOT NULL,
    PRIMARY KEY (order_id, status)
  ) WITHOUT ROWID`).execute();
  // о статусах прошлых заказов считаем, что уже сообщили
  app.db().newQuery(`INSERT OR IGNORE INTO order_notified (order_id, status, at)
    SELECT id, status, datetime('now') FROM orders WHERE status != ''`).execute();
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS order_notified").execute();
});
