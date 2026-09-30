/// <reference path="../pb_data/types.d.ts" />
// Новый раздел каталога: «Кустовые розы пионовидные». Ставим сразу после
// обычных кустовых — на сайте разделы идут по полю sort.
migrate((app) => {
  const NAME = "Кустовые розы пионовидные";
  try { app.findFirstRecordByFilter("categories", "slug = 'kustovye-rozy-pionovidnye'"); return; } catch (_) {}

  let last = 0;
  try {
    app.findRecordsByFilter("categories", "id != ''", "-sort", 1, 0).forEach((r) => { last = +r.get("sort") || 0; });
  } catch (_) {}

  const rec = new Record(app.findCollectionByNameOrId("categories"));
  rec.set("name", NAME);
  rec.set("slug", "kustovye-rozy-pionovidnye");
  rec.set("addon", false);
  rec.set("active", true);
  rec.set("sort", last + 1);
  app.save(rec);
}, (app) => {
  try { app.delete(app.findFirstRecordByFilter("categories", "slug = 'kustovye-rozy-pionovidnye'")); } catch (_) {}
});
