/// <reference path="../pb_data/types.d.ts" />
// Роль «Отдел заботы»: видит заказы, чаты и вкладку «Забота» — всё, что нужно,
// чтобы звонить недовольным. Товары, цены, остатки и настройки ей не нужны.
migrate((app) => {
  const m = app.findCollectionByNameOrId("managers");
  const f = m.fields.getByName("role");
  if (f && f.values && f.values.indexOf("care") < 0) {
    f.values = f.values.concat("care");
    app.save(m);
  }
}, (app) => {
  const m = app.findCollectionByNameOrId("managers");
  const f = m.fields.getByName("role");
  if (f && f.values) { f.values = f.values.filter((v) => v !== "care"); app.save(m); }
});
