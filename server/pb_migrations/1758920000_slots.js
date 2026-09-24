/// <reference path="../pb_data/types.d.ts" />
// Интервалы доставки считаются от времени заказа, а не выбираются из готовой таблицы:
// сначала сборка букета (дороже — дольше), потом трёхчасовое окно, начало кратно получасу.
// Пример: заказ в 13:15 на 8000 ₽ → сборка 45 минут → 14:00–17:00.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "work_from", type: "text", max: 5 }));           // во сколько начинаем возить
  s.fields.add(new Field({ name: "work_to", type: "text", max: 5 }));             // во сколько заканчиваем
  s.fields.add(new Field({ name: "prep_min", type: "number", min: 0 }));          // сборка обычного букета, минут
  s.fields.add(new Field({ name: "prep_min_big", type: "number", min: 0 }));      // сборка дорогого букета
  s.fields.add(new Field({ name: "prep_big_from", type: "number", min: 0 }));     // с какой суммы букет считается дорогим
  s.fields.add(new Field({ name: "slot_hours", type: "number", min: 1 }));        // длина интервала, часов
  s.fields.add(new Field({ name: "slot_step", type: "number", min: 5 }));         // шаг начала интервала, минут
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("work_from", "09:00");
  rec.set("work_to", "21:00");
  rec.set("prep_min", 45);
  rec.set("prep_min_big", 65);
  rec.set("prep_big_from", 10000);
  rec.set("slot_hours", 3);
  rec.set("slot_step", 30);
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["work_from", "work_to", "prep_min", "prep_min_big", "prep_big_from", "slot_hours", "slot_step"]
    .forEach((f) => s.fields.removeByName(f));
  app.save(s);
});
