/// <reference path="../pb_data/types.d.ts" />
// Обязательные поля заказа в МоёмСкладе: канал продаж, способ доставки, тип оплаты.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  [["ms_channel", "text"], ["ms_pay_card", "text"], ["ms_pay_cash", "text"]].forEach(([name, type]) => s.fields.add(new Field({ name, type })));
  app.save(s);
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("ms_channel", "сайт веников");            // канал продаж
  rec.set("ms_pay_card", "CloudPayments");          // тип оплаты при оплате картой на сайте
  rec.set("ms_pay_cash", "Наличные/карта на ТТ");   // тип оплаты при оплате на месте
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["ms_channel", "ms_pay_card", "ms_pay_cash"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
});
