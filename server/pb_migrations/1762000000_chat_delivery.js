/// <reference path="../pb_data/types.d.ts" />
// Доставка ответа менеджера: дошёл ли он до покупателя и почему не дошёл.
// Раньше ошибка жила только во всплывашке админки: менеджер её закрывал и был
// уверен, что ответил, а человек в Телеграме не получал ничего.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chat_messages");
  if (!c.fields.getByName("sent")) c.fields.add(new Field({ name: "sent", type: "bool" }));
  if (!c.fields.getByName("error")) c.fields.add(new Field({ name: "error", type: "text", max: 300 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("chat_messages");
  c.fields.removeByName("sent");
  c.fields.removeByName("error");
  app.save(c);
});
