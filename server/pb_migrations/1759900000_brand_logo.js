/// <reference path="../pb_data/types.d.ts" />
// Логотип витрины картинкой. Раньше у чужого бренда в шапке писалось просто
// название текстом — для LasFlore с его листьями этого мало.
//   logo       — для светлой темы (SVG или PNG)
//   logo_dark  — для тёмной; пусто — берётся светлый
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  const add = (f) => { if (!b.fields.getByName(f.name)) b.fields.add(new Field(f)); };
  const types = ["image/svg+xml", "image/png", "image/webp"];
  add({ name: "logo", type: "file", maxSelect: 1, maxSize: 2097152, mimeTypes: types });
  add({ name: "logo_dark", type: "file", maxSelect: 1, maxSize: 2097152, mimeTypes: types });
  app.save(b);
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  ["logo", "logo_dark"].forEach((n) => b.fields.removeByName(n));
  app.save(b);
});
