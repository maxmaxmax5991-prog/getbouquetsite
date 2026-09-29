/// <reference path="../pb_data/types.d.ts" />
// Витрин у товара может быть несколько. maxSelect: 0 PocketBase понял как «одна»,
// и при сохранении двух галочек оставалась последняя — товар пропадал с venikoff.
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  const f = p.fields.getByName("brands");
  if (f) { f.maxSelect = 20; app.save(p); }
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  const f = p.fields.getByName("brands");
  if (f) { f.maxSelect = 1; app.save(p); }
});
