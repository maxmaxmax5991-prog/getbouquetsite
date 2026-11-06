/// <reference path="../pb_data/types.d.ts" />
// Кто снял букет. Фото готового букета приходит в бот — из группы флористов или
// личкой, — но до сих пор нигде не записывалось, ОТ КОГО. Владелец спросил,
// сколько букетов сделал каждый за день, а ответить было нечем.
//
//   photo_by      — id отправителя в Телеграме (а не чата: в группе это разные
//                   вещи, и по чату все букеты выглядели бы как один человек)
//   photo_by_name — имя из Телеграма на момент съёмки: флорист может уйти, а
//                   отчёт за прошлый месяц должен остаться читаемым
//   photo_at      — когда прислали, по нему и считаем «за сегодня»: created у
//                   заказа — это когда его оформил покупатель, а не когда сняли
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  if (!c.fields.getByName("photo_by")) c.fields.add(new Field({ name: "photo_by", type: "text", max: 40 }));
  if (!c.fields.getByName("photo_by_name")) c.fields.add(new Field({ name: "photo_by_name", type: "text", max: 80 }));
  if (!c.fields.getByName("photo_at")) c.fields.add(new Field({ name: "photo_at", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("photo_by");
  c.fields.removeByName("photo_by_name");
  c.fields.removeByName("photo_at");
  app.save(c);
});
