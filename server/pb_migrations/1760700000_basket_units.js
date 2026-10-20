/// <reference path="../pb_data/types.d.ts" />
// Сколько «мест» в корзине занимает один стебель.
//
// Вместимость корзины меряется одноголовыми розами, но кустовая и французская
// занимают места двух одноголовых, а гортензия — трёх. Без этого корзина «до
// 251» приняла бы 251 гортензию, то есть втрое больше, чем в неё влезает
// физически, и флорист остался бы с этим один на один.
//
// Число держим у раздела, а не у сорта: оно зависит от вида цветка, а не от
// сорта, и копии по сорока карточкам неминуемо разъехались бы.
migrate((app) => {
  const c = app.findCollectionByNameOrId("categories");
  if (!c.fields.getByName("basket_units")) c.fields.add(new Field({ name: "basket_units", type: "number", min: 0 }));
  app.save(c);

  // Со слов владельца 19.10.2026.
  const МЕСТА = {
    "single": 1, "ecuador-premium": 1, "kenya": 1,
    "french": 2, "kustovye-rozy": 2, "kustovye-rozy-pionovidnye": 2,
    "hydrangea": 3,
  };
  let все = [];
  try { все = app.findRecordsByFilter("categories", "id != ''", "sort", 100, 0); } catch (_) {}
  все.forEach((x) => {
    const n = МЕСТА[String(x.get("slug") || "")] || 1;
    app.db().newQuery("UPDATE categories SET basket_units = {:n} WHERE id = {:id}").bind({ n, id: x.id }).execute();
  });
}, (app) => {
  const c = app.findCollectionByNameOrId("categories");
  c.fields.removeByName("basket_units");
  app.save(c);
});
