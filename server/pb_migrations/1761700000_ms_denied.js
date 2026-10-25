/// <reference path="../pb_data/types.d.ts" />
// Пауза отправки, когда склад закрыл доступ.
//
// 25.10 МойСклад ограничил доступ сотрудника к API, и очередь отправки заказов
// целую ночь била в стену раз в минуту: 1356 отказов подряд. Для склада это
// выглядит злоупотреблением, а в журнале за этим не видно настоящих ошибок.
// Здесь лежит время, до которого отправку не пробуем (миллисекунды).
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  if (!c.fields.getByName("ms_denied_until")) c.fields.add(new Field({ name: "ms_denied_until", type: "number" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("ms_denied_until");
  app.save(c);
});
