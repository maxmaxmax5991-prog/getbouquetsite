/// <reference path="../pb_data/types.d.ts" />
// Вечером трёхчасовое окно не помещалось до конца дня, и заказ на сегодня
// оформить было нельзя. Разделяем два времени:
//   work_to      — до скольких отправляем букеты (последнее начало интервала), 21:00
//   delivery_to  — крайнее время доставки: позже него окно не заканчивается, 23:00
// Плюс slot_min — если целое окно уже не влезает, предлагаем последнее покороче.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "slot_min", type: "number", min: 0 }));
  s.fields.add(new Field({ name: "delivery_to", type: "text", max: 5 }));
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("slot_min", 60);
  rec.set("delivery_to", "23:00");
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["slot_min", "delivery_to"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
});
