/// <reference path="../pb_data/types.d.ts" />
// Комментарий покупателя курьеру: «позвонить за час», «оставить на охране»,
// «не звонить в дверь, спит ребёнок». Отдельно от текста открытки — это разные
// вещи, и путать их нельзя: открытка едет в букете, а это нужно курьеру.
migrate((app) => {
  const c = app.findCollectionByNameOrId("orders");
  if (!c.fields.getByName("delivery_note")) c.fields.add(new Field({ name: "delivery_note", type: "text", max: 500 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("orders");
  c.fields.removeByName("delivery_note");
  app.save(c);
});
