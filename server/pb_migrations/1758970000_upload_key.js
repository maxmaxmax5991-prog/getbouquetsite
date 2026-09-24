/// <reference path="../pb_data/types.d.ts" />
// Отдельная ссылка для управляющей: страница /add/ — загрузить товар с фото.
// Вход не по логину, а по ключу в самой ссылке, чтобы не заводить ей аккаунт
// и не пускать в заказы и настройки. Ключ виден владельцу в админке, там же
// его можно сменить — старая ссылка сразу перестаёт работать.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "upload_key", type: "text", max: 40 }));
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  if (!rec.get("upload_key")) rec.set("upload_key", $security.randomString(24));
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("upload_key");
  app.save(s);
});
