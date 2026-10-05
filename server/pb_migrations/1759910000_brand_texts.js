/// <reference path="../pb_data/types.d.ts" />
// Свои тексты у витрины. Раньше своими были только три строки шапки, а
// «Оптовые цены в розницу», «Не магазин, а цветочный завод» и прочее — общими,
// и у LasFlore на главной говорил venikoff. Ключ — метка data-t в index.html,
// значение — текст; *так* выделяется жирным. Пусто — остаётся текст venikoff.
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  if (!b.fields.getByName("texts")) b.fields.add(new Field({ name: "texts", type: "json", maxSize: 20000 }));
  app.save(b);
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  b.fields.removeByName("texts");
  app.save(b);
});
