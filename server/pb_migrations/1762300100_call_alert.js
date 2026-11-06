/// <reference path="../pb_data/types.d.ts" />
// Отметка «про этот заказ уже позвали звонить»: чтобы сигнал в бот ушёл один
// раз, а не каждую минуту. Порог в минутах настраивается — call_after в настройках.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  if (!c.fields.getByName("call_alert")) c.fields.add(new Field({ name: "call_alert", type: "bool" }));
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("call_after")) s.fields.add(new Field({ name: "call_after", type: "number", min: 1, max: 120 }));
  app.save(s);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("call_alert");
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("call_after");
  app.save(s);
});
