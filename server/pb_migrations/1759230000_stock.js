/// <reference path="../pb_data/types.d.ts" />
// Остатки по длинам и пометка «только на сайте».
// stock — сколько стеблей забронировано под сайт: {"40": 360, "70": 80}.
// Пусто (нет ключа для длины) — учёта по этой длине нет, продаём без ограничений.
// Ноль — закончились: размер на сайте не показываем.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("stock")) c.fields.add(new Field({ name: "stock", type: "json", maxSize: 4000 }));
  if (!c.fields.getByName("site_only")) c.fields.add(new Field({ name: "site_only", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  ["stock", "site_only"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
