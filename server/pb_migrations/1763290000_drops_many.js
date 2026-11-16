/// <reference path="../pb_data/types.d.ts" />
// Несколько дропов в один день (16.11.2026, решение владельца: второй дроп —
// кустовые «Фрутти Баблз» рядом с дропом дня).
//
// Таблица drops была заведена с уникальным индексом по дате: второй дроп на
// тот же день база не пустила бы, а админка искала дроп по дате и молча
// перезаписала бы первый вместе с его очередью. Индекс оставляем, но
// неуникальный: по дате дропы по-прежнему ищутся быстро.
// Миграция — правка схемы без перебора записей, сервер не задерживает.
migrate((app) => {
  const c = app.findCollectionByNameOrId("drops");
  c.indexes = ["CREATE INDEX idx_drops_date ON drops (date)"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("drops");
  c.indexes = ["CREATE UNIQUE INDEX idx_drops_date ON drops (date)"];
  app.save(c);
});
