// Отметка о чеке — это время плюс номер чека в кассе (32 знака), в сорок
// символов не влезает. Запись шла запросом, мимо проверок, зато падало
// обычное сохранение заказа: ms-status каждую минуту ругался
// «receipt_at: Must be no more than 40 character(s)» и не обновлял статусы.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  const f = c.fields.getByName("receipt_at");
  f.max = 80;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  const f = c.fields.getByName("receipt_at");
  f.max = 40;
  app.save(c);
});
