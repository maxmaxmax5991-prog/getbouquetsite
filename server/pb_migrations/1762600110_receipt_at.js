// Когда по заказу пробит онлайн-чек. Нужно, чтобы видеть это в карточке
// заказа и в сверке; сама защита от повторов живёт в order_notified.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.add(new TextField({ name: "receipt_at", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("receipt_at");
  app.save(c);
});
