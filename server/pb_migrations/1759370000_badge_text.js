/// <reference path="../pb_data/types.d.ts" />
// Своя надпись на фото товара: «Тот самый из Reels», «Хит недели» и что угодно ещё.
// Готовых меток (акция, хит, новинка) на все случаи не хватает.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("badge_text")) c.fields.add(new Field({ name: "badge_text", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("badge_text");
  app.save(c);
});
