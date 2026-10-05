/// <reference path="../pb_data/types.d.ts" />
// Страницы для поисковиков: Caddy присылает сюда каждый адрес сайта без файла.
// Что и как отдаём — в lib/page.js.
routerAdd("GET", "/api/page", (e) => {
  return require(`${__hooks}/lib/page.js`).serve($app, e);
});

// У каждого товара есть адрес страницы. Новая карточка получает его из названия;
// переименование адрес не трогает — иначе ссылки из поиска вели бы в пустоту.
onRecordCreate((e) => {
  if (!e.record.get("slug")) e.record.set("slug", require(`${__hooks}/lib/slug.js`).unique(e.app, e.record.get("name"), ""));
  e.next();
}, "products");

onRecordUpdate((e) => {
  if (!e.record.get("slug")) e.record.set("slug", require(`${__hooks}/lib/slug.js`).unique(e.app, e.record.get("name"), e.record.id));
  e.next();
}, "products");
