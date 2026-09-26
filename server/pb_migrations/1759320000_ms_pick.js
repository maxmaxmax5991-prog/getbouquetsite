/// <reference path="../pb_data/types.d.ts" />
// Ручная привязка товара к номенклатуре МоегоСклада.
// Названия на сайте и в складе расходятся («Кейтлин» — «ЛФ-Роза куст Кэйт Линн»),
// автоподбор такое не угадает и правильно делает, что не угадывает.
// Храним по длине: {"40": {"id": "...", "name": "ЛФ-Роза куст Кэйт Линн 40см"}}.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ms_pick")) c.fields.add(new Field({ name: "ms_pick", type: "json", maxSize: 6000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("ms_pick");
  app.save(c);
});
