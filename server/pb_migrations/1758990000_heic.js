/// <reference path="../pb_data/types.d.ts" />
// Снимки с айфона приходят в HEIC. Разрешаем их загружать, а сервер сам
// переведёт их в JPEG (задание heic-convert): сам PocketBase такие файлы
// не умеет уменьшать, и без перевода на сайте была бы пустая картинка.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  f.mimeTypes = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  f.mimeTypes = ["image/jpeg", "image/png", "image/webp"];
  app.save(c);
});
