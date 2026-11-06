/// <reference path="../pb_data/types.d.ts" />
// Порог «дешёвой» плитки у витрины. Нужен правилу «сначала дешёвые и ходовые»:
// первыми идут недорогие конфигурации, которые реально покупают, следом похожие
// на них по цене, и только потом дорогое. Где проходит граница — решает
// владелец: на venikoff.net вход 2 990 ₽, на другой витрине он может быть иным.
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  if (!b.fields.getByName("tile_cheap_to")) b.fields.add(new Field({ name: "tile_cheap_to", type: "number", min: 0 }));
  app.save(b);
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  b.fields.removeByName("tile_cheap_to");
  app.save(b);
});
