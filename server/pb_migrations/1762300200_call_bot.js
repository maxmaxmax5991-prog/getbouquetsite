/// <reference path="../pb_data/types.d.ts" />
// Свой бот под обзвон брошенных оплат. Сигнал «позвоните сейчас» не должен
// тонуть в общем потоке служебного бота: там и заказы, и остатки, и фото
// флористов, а звонить надо в ближайшие минуты, иначе смысла нет.
//
//   call_token  — ключ бота, в который падают сигналы
//   call_chats  — кому слать: номера чатов через запятую
//   call_offset — позиция чтения обновлений этого бота
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("call_token")) s.fields.add(new Field({ name: "call_token", type: "text", max: 100 }));
  if (!s.fields.getByName("call_chats")) s.fields.add(new Field({ name: "call_chats", type: "text", max: 300 }));
  if (!s.fields.getByName("call_offset")) s.fields.add(new Field({ name: "call_offset", type: "number" }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("call_token");
  s.fields.removeByName("call_chats");
  s.fields.removeByName("call_offset");
  app.save(s);
});
