/// <reference path="../pb_data/types.d.ts" />
// Третий уровень доступа в служебный бот: «только уведомления».
// Человек видит всё, что происходит — заказы, оплаты, сообщения покупателей,
// ошибки, — но ничего изменить не может: ни «Стоп заказов», ни цены, ни товары,
// ни ответ клиенту. Раньше выбор был жёсткий: или полное управление, или ничего.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("tg_watchers")) s.fields.add(new Field({ name: "tg_watchers", type: "text", max: 400 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("tg_watchers");
  app.save(s);
});
