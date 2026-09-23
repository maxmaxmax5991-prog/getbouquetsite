/// <reference path="../pb_data/types.d.ts" />
// Услуга доставки в МоёмСкладе — отдельной строкой в заказе.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "ms_delivery_name", type: "text" }));
  app.save(s);
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("ms_delivery_name", "ЛФ-Доставка Москва");
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("ms_delivery_name");
  app.save(s);
});
