// Партия: «привезли для вас N роз по лучшей цене». Подаётся как дроп, но
// продаётся обычной карточкой — человек выбирает количество, а сверху видно,
// сколько стеблей от партии ещё свободно. Счётчик считается от настоящего
// остатка, поэтому партия кончается сама, без ручного выключения.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new NumberField({ name: "batch_total", min: 0 }));   // сколько привезли
  c.fields.add(new TextField({ name: "batch_note", max: 120 }));     // надпись на карточке
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  ["batch_total", "batch_note"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
