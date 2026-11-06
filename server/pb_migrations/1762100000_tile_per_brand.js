/// <reference path="../pb_data/types.d.ts" />
// Плитка товаров — своя у каждой витрины.
//
// На venikoff.net идёт в 2,3 раза больше трафика, а конверсия в полтора раза
// ниже и чек меньше: это холодная широкая аудитория из рилсов, ей нужен дешёвый
// вход. Гет Букету наоборот — там каждый двенадцатый заказ дороже 15 000 ₽.
// Раньше порядок плитки и размер, с которым открывается карточка, были общими
// на все три сайта.
//
//   tile_order   — чем сортировать плитку: '' как сейчас (перемешивать раз в
//                  час), 'demand' по спросу этой витрины, 'cheap' дешёвые
//                  вперёд, 'rich' дорогие вперёд.
//   tile_default — с какого размера открывается карточка: '' как в прайсе
//                  (обычно 51 шт), 'cheap' самый дешёвый из доступных.
//   rank_by      — спрос по витринам, {"<id витрины>": балл}. Считает раз в
//                  сутки cronAdd("tile-rank").
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  if (!b.fields.getByName("tile_order")) b.fields.add(new Field({ name: "tile_order", type: "text", max: 20 }));
  if (!b.fields.getByName("tile_default")) b.fields.add(new Field({ name: "tile_default", type: "text", max: 20 }));
  app.save(b);

  const p = app.findCollectionByNameOrId("products");
  if (!p.fields.getByName("rank_by")) p.fields.add(new Field({ name: "rank_by", type: "json", maxSize: 2000000 }));
  app.save(p);
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  b.fields.removeByName("tile_order");
  b.fields.removeByName("tile_default");
  app.save(b);
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("rank_by");
  app.save(p);
});
