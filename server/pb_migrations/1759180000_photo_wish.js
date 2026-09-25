/// <reference path="../pb_data/types.d.ts" />
// Ещё одно состояние фото: «клиент нажал „напишу сам“ и сейчас пишет правку».
// Без него следующее сообщение покупателя считалось бы ответом на «нравится?».
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.getByName("photo_status").values = ["waiting", "approved", "rework", "wish"];
  app.save(o);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  app.db().newQuery("UPDATE orders SET photo_status = 'waiting' WHERE photo_status = 'wish'").execute();
  o.fields.getByName("photo_status").values = ["waiting", "approved", "rework"];
  app.save(o);
});
