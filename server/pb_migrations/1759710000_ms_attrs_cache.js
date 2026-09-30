/// <reference path="../pb_data/types.d.ts" />
// Список доп. полей заказа запрашивался у МоегоСклада при каждой отправке.
// В утренний вал заказов склад отвечал «превышено ограничение на количество
// запросов», список не приходил, и заказ уходил вообще без доп. полей — без
// времени доставки, способа доставки и типа оплаты. Так вышло у №3128 и №3195.
// Поля меняются раз в год, поэтому запоминаем их на час.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("ms_attrs_cache")) c.fields.add(new Field({ name: "ms_attrs_cache", type: "json", maxSize: 20000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("ms_attrs_cache");
  app.save(c);
});
