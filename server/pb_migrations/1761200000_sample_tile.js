/// <reference path="../pb_data/types.d.ts" />
// Плитка в каталоге берётся из примеров корзин.
//
// Сначала я завёл признак у самой корзины, но снимки живут в примерах: там
// фотография настоящей собранной корзины с количеством и сортом, а у основы —
// в лучшем случае фото пустой плетёнки. Владелец сказал прямо: брать из
// примера. Признак у примера, и он один на все — две карточки «соберите
// корзину» в ряду каталога это путаница, а не выбор.
migrate((app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  if (!c.fields.getByName("tile")) c.fields.add(new Field({ name: "tile", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  c.fields.removeByName("tile");
  app.save(c);
});
