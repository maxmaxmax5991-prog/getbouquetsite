/// <reference path="../pb_data/types.d.ts" />
// Запоминаем найденные значения справочников МоегоСклада («Тип Оплаты»,
// «Способ доставки»). Раньше каждое поле требовало отдельного запроса к складу,
// и при сбое связи поле молча оставалось пустым — так у заказа №3143 не
// заполнился тип оплаты. Значения меняются раз в год, спрашивать каждый раз незачем.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("ms_dict_cache")) c.fields.add(new Field({ name: "ms_dict_cache", type: "json", maxSize: 8000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("ms_dict_cache");
  app.save(c);
});
