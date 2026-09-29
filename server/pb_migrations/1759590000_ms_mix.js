/// <reference path="../pb_data/types.d.ts" />
// Состав микса в долях: «пинк 7, сноу 7, блю 11» — это пропорция, а не жёсткие штуки.
// Букет продаётся по 7/15/25/35/51 стеблей, и склад должен списывать сорта
// в той же пропорции от заказанного количества, а не одно и то же число.
// Вид: [{"id":"<номенклатура>","name":"ЛФ-Гортензия Пинк","share":7}]
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ms_mix")) c.fields.add(new Field({ name: "ms_mix", type: "json", maxSize: 6000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("ms_mix");
  app.save(c);
});
