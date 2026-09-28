/// <reference path="../pb_data/types.d.ts" />
// Экспресс-позиции: готовый букет стоит собранный, продаём штуками.
// Не стебли (это stock), а именно количество готовых букетов.
// Пусто — обычный товар, число — сколько осталось; ноль — разобрали.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ready_qty")) c.fields.add(new Field({ name: "ready_qty", type: "number", min: 0 }));
  if (!c.fields.getByName("is_express")) c.fields.add(new Field({ name: "is_express", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  ["ready_qty", "is_express"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
