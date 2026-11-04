/// <reference path="../pb_data/types.d.ts" />
// Очередь дропа: «один человек — одно место» считалось по паре (дроп, покупатель).
// Пока в очередь записывал только бот, у всех был кабинет. С 4 ноября букет можно
// забрать без входа — у таких записей покупатель пустой, и второй такой же
// гость упирался в «Value must be unique»: сайт отвечал «вас нет в очереди»,
// и человек просто уходил. Телефон в записи есть всегда, им и различаем гостей.
migrate((app) => {
  const c = app.findCollectionByNameOrId("drop_queue");
  c.indexes = (c.indexes || []).filter((x) => String(x).indexOf("idx_dq_once") < 0);
  c.indexes.push("CREATE UNIQUE INDEX `idx_dq_once` ON `drop_queue` (`drop`, `customer`, `phone`)");
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("drop_queue");
  c.indexes = (c.indexes || []).filter((x) => String(x).indexOf("idx_dq_once") < 0);
  c.indexes.push("CREATE UNIQUE INDEX `idx_dq_once` ON `drop_queue` (`drop`, `customer`)");
  app.save(c);
});
