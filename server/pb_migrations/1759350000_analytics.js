/// <reference path="../pb_data/types.d.ts" />
// Всё для развёрнутой статистики:
//  events   — шаги посетителя на сайте (карточка, корзина, оформление) для воронки;
//  orders.source   — откуда пришёл человек, чтобы считать выручку по источникам;
//  orders.vid      — тот же ключ посетителя, что в счётчике: связывает заход и заказ;
//  orders.zone_name— пояс доставки словами, для разреза по географии;
//  orders.stamps   — когда заказ переходил в каждый статус, для сроков и опозданий.
migrate((app) => {
  app.db().newQuery(`CREATE TABLE IF NOT EXISTS events (
    day  TEXT NOT NULL,
    vid  TEXT NOT NULL,
    kind TEXT NOT NULL,
    ctx  TEXT NOT NULL DEFAULT '',
    at   TEXT NOT NULL,
    PRIMARY KEY (day, vid, kind, ctx)
  ) WITHOUT ROWID`).execute();
  app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_events_day ON events (day, kind)").execute();

  const o = app.findCollectionByNameOrId("orders");
  if (!o.fields.getByName("source")) o.fields.add(new Field({ name: "source", type: "text", max: 60 }));
  if (!o.fields.getByName("vid")) o.fields.add(new Field({ name: "vid", type: "text", max: 40 }));
  if (!o.fields.getByName("zone_name")) o.fields.add(new Field({ name: "zone_name", type: "text", max: 80 }));
  if (!o.fields.getByName("stamps")) o.fields.add(new Field({ name: "stamps", type: "json", maxSize: 2000 }));
  app.save(o);
}, (app) => {
  app.db().newQuery("DROP TABLE IF EXISTS events").execute();
  const o = app.findCollectionByNameOrId("orders");
  ["source", "vid", "zone_name", "stamps"].forEach((n) => o.fields.removeByName(n));
  app.save(o);
});
