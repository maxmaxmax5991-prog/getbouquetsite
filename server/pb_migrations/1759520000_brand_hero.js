/// <reference path="../pb_data/types.d.ts" />
// Тексты шапки — свойство витрины. «Букет, а не веник» — игра со словом venikoff,
// второму бренду она не подходит, поэтому заголовок и описание у каждого свои.
migrate((app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["hero_eyebrow", "hero_title", "hero_em", "hero_text"].forEach((n) => {
    if (!c.fields.getByName(n)) c.fields.add(new Field({ name: n, type: "text", max: 300 }));
  });
  app.save(c);

  // у первой витрины — то, что на сайте сейчас, слово в слово
  try {
    const v = app.findFirstRecordByFilter("brands", "slug = 'venikoff'");
    v.set("hero_eyebrow", "Оптовые цены в розницу · Москва 🌷");
    v.set("hero_title", "Букет,");
    v.set("hero_em", "а не веник.");          // выделяется цветом
    v.set("hero_text", "Тот самый цветочный: оптовые цены, невероятный ассортимент. Берём цветы напрямую от производителей и присылаем фото букета перед доставкой.");
    app.save(v);
  } catch (_) {}
}, (app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["hero_eyebrow", "hero_title", "hero_em", "hero_text"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
