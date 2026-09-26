/// <reference path="../pb_data/types.d.ts" />
// Флорист в служебном боте: может только отправлять фото готовых букетов.
// Цены, «Стоп заказов», товары и чужие телефоны с адресами ему недоступны.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("tg_florists")) s.fields.add(new Field({ name: "tg_florists", type: "text", max: 500 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("tg_florists");
  app.save(s);
});
