/// <reference path="../pb_data/types.d.ts" />
// Оплата картой через CloudPayments: ключи в настройках, статус оплаты у заказов.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "cp_public_id", type: "text" }));       // Public ID из личного кабинета CloudPayments
  s.fields.add(new Field({ name: "cp_secret", type: "text" }));          // API-секрет (только на сервере, наружу не отдаётся)
  s.fields.add(new Field({ name: "pay_card", type: "bool" }));           // принимать оплату картой на сайте
  s.fields.add(new Field({ name: "pay_on_delivery", type: "bool" }));    // разрешить оплату при получении
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("pay_on_delivery", true);
  app.save(rec);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "payment_method", type: "select", maxSelect: 1, values: ["card", "on_delivery"] }));
  o.fields.add(new Field({ name: "payment_status", type: "select", maxSelect: 1, values: ["unpaid", "paid", "failed", "refunded"] }));
  o.fields.add(new Field({ name: "payment_id", type: "text" }));         // номер операции в CloudPayments
  o.fields.add(new Field({ name: "paid_at", type: "text" }));
  app.save(o);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["cp_public_id", "cp_secret", "pay_card", "pay_on_delivery"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const o = app.findCollectionByNameOrId("orders");
  ["payment_method", "payment_status", "payment_id", "paid_at"].forEach((f) => o.fields.removeByName(f));
  app.save(o);
});
