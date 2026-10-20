/// <reference path="../pb_data/types.d.ts" />
// Свой прайс для роз в корзине.
//
// В корзину роза идёт не по цене букета: там другая работа флориста и другая
// себестоимость сборки. Владелец задаёт цену за стебель отдельно и по каждой
// ростовке. Храним как «группа сортов (прайс) → ростовка → цена за стебель»;
// пустая клетка значит «считать по обычному прайсу сорта», поэтому включение
// этой таблицы ничего не ломает, пока она не заполнена.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("basket_prices")) s.fields.add(new Field({ name: "basket_prices", type: "json" }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("basket_prices");
  app.save(s);
});
