/// <reference path="../pb_data/types.d.ts" />
// Фото товара показывались везде в 560 точек — на карточке это незаметно,
// а на странице товара, где снимок во всю ширину, видно мягкость.
// Добавляем размер 1080 точек: для экрана телефона с запасом, а весит
// втрое меньше оригинала (оригиналы у нас по 5712 точек и 3 МБ).
// PocketBase отдаёт только те размеры, что перечислены здесь; неизвестный
// размер молча возвращает оригинал.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  f.thumbs = ["560x0", "160x160", "1080x0"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  f.thumbs = ["560x0", "160x160"];
  app.save(c);
});
