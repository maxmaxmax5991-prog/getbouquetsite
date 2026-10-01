/// <reference path="../pb_data/types.d.ts" />
// Номенклатура доставки искалась в МоёмСкладе по названию при каждой отправке.
// Под ограничением запросов поиск не проходил, и строка доставки просто не
// добавлялась в заказ — молча. У №3195 в складе оказалось 2990 ₽ вместо 3789:
// доставка на 799 ₽ потерялась. Запоминаем номер услуги.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("ms_delivery_id")) c.fields.add(new Field({ name: "ms_delivery_id", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("ms_delivery_id");
  app.save(c);
});
