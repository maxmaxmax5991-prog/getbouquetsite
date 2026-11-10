/// <reference path="../pb_data/types.d.ts" />
// Партию теперь заводит владелец сам, из вкладки «Партии». На время партии
// карточка переезжает на отдельный прайс (у Фридома это «freedom»: 6 000
// стеблей по цене ниже каталожной). Чтобы по окончании вернуть карточку туда,
// где она была, запоминаем прежний прайс прямо на товаре — иначе после
// остановки партии цена осталась бы оптовой навсегда.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new TextField({ name: "batch_prev_table", max: 60 }));
  app.save(c);
  // Идущую партию Фридома не трогаем: она на обычном прайсе tmvb2ad9i
  // (спецтаблицу «freedom» убрали 10.11 — «настоящие цены с карточки»),
  // возвращать нечего, и пустое поле здесь — верное значение.
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("batch_prev_table");
  app.save(c);
});
