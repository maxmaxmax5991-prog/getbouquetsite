/// <reference path="../pb_data/types.d.ts" />
// Сколько цветов на самом снимке. Раньше подпись на фото бралась из выбранного размера,
// и на фото с 25 розами могло быть написано «101 роза». Теперь у каждого фото своё число,
// владелец проставляет его в админке. Пусто — подписи нет.
// Ключ — имя файла фото, значение — число.
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "photo_counts", type: "json" }));
  app.save(p);
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("photo_counts");
  app.save(p);
});
