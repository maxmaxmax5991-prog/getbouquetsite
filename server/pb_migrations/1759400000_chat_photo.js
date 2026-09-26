/// <reference path="../pb_data/types.d.ts" />
// Фото в чате: покупатель показывает, какой букет хочет, менеджер — что получилось.
// HEIC с айфона принимаем: сервер уже умеет переводить такие снимки.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chat_messages");
  if (!c.fields.getByName("photo")) {
    c.fields.add(new Field({
      name: "photo", type: "file", maxSelect: 1, maxSize: 12000000,
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
      thumbs: ["480x0", "1200x0"],
    }));
  }
  // текст перестаёт быть обязательным: можно прислать одну картинку
  const t = c.fields.getByName("text");
  if (t) t.required = false;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("chat_messages");
  c.fields.removeByName("photo");
  const t = c.fields.getByName("text");
  if (t) t.required = true;
  app.save(c);
});
