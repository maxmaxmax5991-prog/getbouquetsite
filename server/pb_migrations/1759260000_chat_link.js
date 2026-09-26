/// <reference path="../pb_data/types.d.ts" />
// Человек мог начать чат до входа и до заказа, а потом войти в кабинет.
// Тогда диалоги надо склеить, иначе менеджер видит две переписки одного покупателя.
// У склеенного диалога несколько ключей браузера: основной в token, остальные в alt.
migrate((app) => {
  const c = app.findCollectionByNameOrId("chats");
  if (!c.fields.getByName("alt")) c.fields.add(new Field({ name: "alt", type: "text", max: 2000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("chats");
  c.fields.removeByName("alt");
  app.save(c);
});
