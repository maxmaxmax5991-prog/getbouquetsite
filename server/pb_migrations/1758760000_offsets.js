/// <reference path="../pb_data/types.d.ts" />
// Храним позицию чтения сообщений ботов в базе: после перезапуска бот не повторяет ответы.
// И публичное хранилище фото букета, чтобы клиентский бот мог его отправить.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "tg_offset", type: "number" }));
  s.fields.add(new Field({ name: "tg_offset_client", type: "number" }));
  app.save(s);

  const photos = new Collection({
    type: "base",
    name: "order_photos",
    listRule: null, viewRule: "", createRule: null, updateRule: null, deleteRule: null,   // ссылку знает только клиент
    fields: [
      { name: "order", type: "text" },
      { name: "photo", type: "file", maxSelect: 1, maxSize: 15 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "created", type: "autodate", onCreate: true },
    ],
  });
  app.save(photos);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["tg_offset", "tg_offset_client"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  try { app.delete(app.findCollectionByNameOrId("order_photos")); } catch (_) {}
});
