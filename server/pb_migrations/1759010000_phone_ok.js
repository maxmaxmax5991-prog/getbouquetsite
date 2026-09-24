/// <reference path="../pb_data/types.d.ts" />
// Подтверждённый номер покупателя — тот, что прислал сам Телеграм по кнопке
// «Поделиться номером». Только он пускает к прошлым заказам.
//
// Поле `phone` покупатель правит в кабинете сам, поэтому ключом для поиска оно быть
// не может: вписав чужой номер, человек видел чужие заказы — имя, адрес, телефон,
// текст открытки. Теперь `phone` только подставляется в форму заказа.
migrate((app) => {
  const c = app.findCollectionByNameOrId("customers");
  c.fields.add(new Field({ name: "phone_ok", type: "text" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("customers");
  c.fields.removeByName("phone_ok");
  app.save(c);
});
