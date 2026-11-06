/// <reference path="../pb_data/types.d.ts" />
// Заявки на подключение к сигналам обзвона: кто написал боту и ждёт, пока
// владелец нажмёт «Добавить». В сигнале имя и телефон покупателя, поэтому
// случайный человек, нашедший бота по названию, подключаться сам не должен.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("call_pending")) s.fields.add(new Field({ name: "call_pending", type: "json", maxSize: 20000 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("call_pending");
  app.save(s);
});
