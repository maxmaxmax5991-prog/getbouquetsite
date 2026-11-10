// Судьба денег по отменённому оплаченному заказу: вернули или остались.
// Без этого ответа нельзя ни пробить чек возврата, ни свести кассу —
// за месяц так накопилось 23 заказа на 204 778 ₽ без ответа.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.add(new TextField({ name: "refund", max: 10 }));   // '' | returned | kept
  c.fields.add(new TextField({ name: "refund_at", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  ["refund", "refund_at"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
