/// <reference path="../pb_data/types.d.ts" />
// Канал продаж искался в МоёмСкладе по названию при каждой отправке заказа.
// Та же беда, что со списком доп. полей: в вал заказов склад отвечает
// «превышено ограничение на количество запросов», канал не находится и заказ
// уходит без него — молча, даже без предупреждения. Запоминаем номер канала.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("ms_channel_id")) c.fields.add(new Field({ name: "ms_channel_id", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("ms_channel_id");
  app.save(c);
});
