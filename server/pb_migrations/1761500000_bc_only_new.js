/// <reference path="../pb_data/types.d.ts" />
// Рассылка только тем, кто ещё не покупал.
//
// Подписчик без заказа и покупатель — разные разговоры: первому нужно «вот
// что у нас есть», второму «вы брали, вот новое». Признак у самой рассылки, а
// не у источника: один и тот же бот сегодня шлёт новичкам, завтра всем.
migrate((app) => {
  const c = app.findCollectionByNameOrId("broadcasts");
  if (!c.fields.getByName("only_new")) c.fields.add(new Field({ name: "only_new", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("broadcasts");
  c.fields.removeByName("only_new");
  app.save(c);
});
