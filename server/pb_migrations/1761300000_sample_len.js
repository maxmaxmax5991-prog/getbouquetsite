/// <reference path="../pb_data/types.d.ts" />
// Состав примера корзины: сорт + ростовка + количество, до трёх сортов.
//
// Раньше у примера был один сорт и общее число, а цену мы считали по самой
// дешёвой ростовке этого сорта. Для настоящей корзины это неверно вдвойне:
// корзина 501 Пинк Аваланж из заказа 5159 собрана в 60 см и стоит 70 120 ₽
// (по дешёвой ростовке выходило 60 100 ₽), а в корзине вообще может стоять
// до трёх сортов. На снимке — конкретная корзина, значит и состав конкретный.
// Поля qty и product оставляем: туда пишем сумму и первый сорт, на них
// держатся подпись плитки и старые примеры.
migrate((app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  if (!c.fields.getByName("parts")) c.fields.add(new Field({ name: "parts", type: "json", maxSize: 20000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("basket_samples");
  c.fields.removeByName("parts");
  app.save(c);
});
