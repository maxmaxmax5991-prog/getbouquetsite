/// <reference path="../pb_data/types.d.ts" />
// Разовая отметка завоза: сегодня приехало всё, кроме французских роз и гортензий.
// Дальше это делается кнопками в админке, «Цветы в пути» → «Что приехало сегодня».
migrate((app) => {
  const day = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);   // сегодня по Москве
  const БЕЗ_ЗАВОЗА = ["Французские розы", "Гортензии"];
  let cats = [];
  try { cats = app.findRecordsByFilter("categories", "active = true", "sort", 100, 0); } catch (_) {}
  cats.filter((c) => !c.get("addon")).forEach((c) => {
    const свежие = БЕЗ_ЗАВОЗА.indexOf(String(c.get("name"))) < 0;
    app.db().newQuery("UPDATE products SET fresh_date = {:d} WHERE active = true AND category = {:c}")
      .bind({ d: свежие ? day : "", c: c.id }).execute();
  });
}, (app) => {
  app.db().newQuery("UPDATE products SET fresh_date = ''").execute();
});
