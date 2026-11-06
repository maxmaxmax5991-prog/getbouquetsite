/// <reference path="../pb_data/types.d.ts" />
// Закреплённые сорта у витрины: список id товаров, которые идут первыми в
// плитке именно на этом сайте. Поле `featured` для этого не годится — оно одно
// на все три витрины, а закреплять нужно по-разному: на venikoff.net своя
// ходовая позиция, у Гет Букета своя.
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  if (!b.fields.getByName("tile_pins")) b.fields.add(new Field({ name: "tile_pins", type: "json", maxSize: 20000 }));
  app.save(b);
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  b.fields.removeByName("tile_pins");
  app.save(b);
});
