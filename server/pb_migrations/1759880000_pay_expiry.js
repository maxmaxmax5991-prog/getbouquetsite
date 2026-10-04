/// <reference path="../pb_data/types.d.ts" />
// Брошенная оплата: учёт попыток, возврат цветов и напоминания.
//
// Зачем. За неделю 35 заказов на 241 тыс ₽ создаются картой и не оплачиваются.
// Бьёт это дважды: мимо кассы проходят деньги И запираются цветы — остаток
// списывается при создании заказа и назад не возвращался никогда. За ту же
// неделю так заперлось 3322 стебля, из-за чего сайт отказывал другим
// покупателям: «осталось 0 штук», хотя цветы лежат в холодильнике.
//
//   pay_tries      — сколько раз открывали окно оплаты
//   pay_error      — что ответил банк в последний раз (отказ карты ≠ «ушёл»)
//   pay_error_at   — когда
//   remind_at      — когда отправили последнее напоминание
//   reminds        — сколько напоминаний ушло
//   stock_back     — остатки по заказу уже вернули (двойного возврата не будет)
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  const добавить = (f) => { if (!c.fields.getByName(f.name)) c.fields.add(new Field(f)); };
  добавить({ name: "pay_tries", type: "number", min: 0 });
  добавить({ name: "pay_error", type: "text", max: 300 });
  добавить({ name: "pay_error_at", type: "text", max: 40 });
  добавить({ name: "remind_at", type: "text", max: 40 });
  добавить({ name: "reminds", type: "number", min: 0 });
  добавить({ name: "stock_back", type: "bool" });
  app.save(c);

  // Срок на оплату — в настройках, чтобы правился без выкладки.
  // unpaid_from — с какого момента машинка работает. Пусто = выключена, и это
  // нарочно: иначе при первом же запуске она написала бы полусотне людей,
  // заказывавших на прошлой неделе. Включается кнопкой в админке.
  const st = app.findCollectionByNameOrId("settings");
  if (!st.fields.getByName("pay_ttl_min")) st.fields.add(new Field({ name: "pay_ttl_min", type: "number", min: 0 }));
  if (!st.fields.getByName("unpaid_from")) st.fields.add(new Field({ name: "unpaid_from", type: "text", max: 40 }));
  app.save(st);
  // Час на оплату — решение владельца 05.10.2026. Запросом, мимо хуков:
  // сохранение записи настроек тянет за собой перенастройку ботов.
  try { app.db().newQuery("UPDATE settings SET pay_ttl_min = 60 WHERE pay_ttl_min IS NULL OR pay_ttl_min = 0").execute(); } catch (_) {}
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  ["pay_tries", "pay_error", "pay_error_at", "remind_at", "reminds", "stock_back"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
