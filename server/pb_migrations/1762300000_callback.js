/// <reference path="../pb_data/types.d.ts" />
// Обзвон брошенных оплат. За 30 дней 422 заказа на 3,2 млн ₽ не были оплачены,
// и 411 из них — люди, которые заказывали у нас впервые: платить вперёд
// незнакомому магазину 7 600 ₽ страшно. Телефон у нас есть у всех, бот — почти
// ни у кого, поэтому единственный живой способ их вернуть — позвонить.
//
//   call_result — чем кончился звонок: promised / later / refused / noanswer / wrong
//   call_at     — когда звонили (по нему же продлеваем жизнь заказа)
//   call_by     — кто звонил
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  if (!c.fields.getByName("call_result")) c.fields.add(new Field({ name: "call_result", type: "text", max: 20 }));
  if (!c.fields.getByName("call_at")) c.fields.add(new Field({ name: "call_at", type: "text", max: 30 }));
  if (!c.fields.getByName("call_by")) c.fields.add(new Field({ name: "call_by", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("call_result");
  c.fields.removeByName("call_at");
  c.fields.removeByName("call_by");
  app.save(c);
});
