/// <reference path="../pb_data/types.d.ts" />
// Состав готового букета для МоегоСклада: какие цветы и сколько стеблей в нём.
// Без этого экспресс уходил в склад как «1 штука» и ничего не списывалось.
// Вид: [{"id":"<номенклатура>","name":"ЛФ-Роза ...","qty":25}]
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ms_parts")) c.fields.add(new Field({ name: "ms_parts", type: "json", maxSize: 8000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("ms_parts");
  app.save(c);
});
