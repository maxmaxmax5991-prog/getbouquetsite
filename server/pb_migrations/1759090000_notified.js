/// <reference path="../pb_data/types.d.ts" />
// Отметка «об этом статусе покупателю уже сообщили».
// Страница заказа, корзина и бот проверяют оплату одновременно, и каждая проверка
// успевала пометить заказ оплаченным — покупателю прилетало три одинаковых сообщения.
// Сравнения со старым значением записи мало: проверки идут в один и тот же миг.
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "notified_status", type: "text", max: 30 }));
  app.save(o);

  // у прошлых заказов считаем, что о текущем статусе уже сообщили
  app.findRecordsByFilter("orders", "id != ''", "", 500, 0).forEach((r) => {
    r.set("notified_status", r.get("status"));
    app.save(r);
  });
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("notified_status");
  app.save(o);
});
