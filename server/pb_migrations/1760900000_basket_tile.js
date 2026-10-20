/// <reference path="../pb_data/types.d.ts" />
// Плитка «Соберите корзину» в каталоге.
//
// Кнопка «Собрать корзину» у каждого сорта — это для того, кто уже выбрал
// цветок. Но человек, который пришёл за корзиной как таковой, сорт выбирать
// не начинает: ему нужна карточка с фотографией готовой корзины в общем ряду
// каталога. Отмечаем у основы «показывать плиткой» и берём её снимок.
migrate((app) => {
  const c = app.findCollectionByNameOrId("baskets");
  if (!c.fields.getByName("tile")) c.fields.add(new Field({ name: "tile", type: "bool" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("baskets");
  c.fields.removeByName("tile");
  app.save(c);
});
