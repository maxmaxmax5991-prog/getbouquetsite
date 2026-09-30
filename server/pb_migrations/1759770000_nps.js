/// <reference path="../pb_data/types.d.ts" />
// Один вопрос вместо трёх: «насколько готовы порекомендовать нас от 1 до 10».
// Три вопроса по кнопкам не прошёл никто — правда, из-за обрыва в обработчике,
// но и сам по себе опрос из трёх шагов длинный. Ответ пишут цифрой.
migrate((app) => {
  const c = app.findCollectionByNameOrId("reviews");
  if (!c.fields.getByName("nps")) c.fields.add(new Field({ name: "nps", type: "number", min: 0, max: 10 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("reviews");
  c.fields.removeByName("nps");
  app.save(c);
});
