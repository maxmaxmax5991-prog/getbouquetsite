/// <reference path="../pb_data/types.d.ts" />
// Номера этапов заказа в МоёмСкладе запоминаем. Раньше их спрашивали отдельным
// запросом в момент отправки: если запрос не прошёл, заказ создавался вообще без
// этапа, и МойСклад ставил свой первый — «Новый». Молча. Так вышло с №3147.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  ["ms_state_paid", "ms_state_unpaid"].forEach((n) => {
    if (!c.fields.getByName(n)) c.fields.add(new Field({ name: n, type: "text", max: 60 }));
  });
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  ["ms_state_paid", "ms_state_unpaid"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
