/// <reference path="../pb_data/types.d.ts" />
// Витрина у заявки на вход.
//
// Зачем. Бот писал «вошли на сайте venikoff.net» всем подряд: имя сайта было
// прописано в тексте жёстко, в трёх местах. Покупатель LasFlore нажимал
// «Войти» на lasflore.ru и получал в ответ чужой адрес; у «Гет Букета» то же.
//
// Брать имя у бота нельзя: в MAX и в служебном боте витрины под рукой нет.
// Правильный источник — сама заявка: человек нажал «Войти» на конкретном
// сайте, и сервер в тот момент уже знает, на каком.
migrate((app) => {
  const c = app.findCollectionByNameOrId("logins");
  if (!c.fields.getByName("brand")) c.fields.add(new Field({ name: "brand", type: "text", max: 40 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("logins");
  c.fields.removeByName("brand");
  app.save(c);
});
