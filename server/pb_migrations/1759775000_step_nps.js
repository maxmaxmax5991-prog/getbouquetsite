/// <reference path="../pb_data/types.d.ts" />
// Шаг опроса «nps» — новый единственный вопрос. Поле «шаг» это список с
// закрытым набором значений, и без этой правки опрос не создавался вовсе:
// сохранение падало с «Invalid value nps».
migrate((app) => {
  const c = app.findCollectionByNameOrId("reviews");
  const f = c.fields.getByName("step");
  if (f && f.values && f.values.indexOf("nps") < 0) {
    f.values = ["nps"].concat(f.values);
    app.save(c);
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("reviews");
  const f = c.fields.getByName("step");
  if (f && f.values) { f.values = f.values.filter((v) => v !== "nps"); app.save(c); }
});
