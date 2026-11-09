// Зачёркнутая цена дропа. Раньше она бралась из прайса — цена того же
// количества той же ростовки в каталоге, — и владелец не мог её назначить.
// Пусто (0) — работает прежний расчёт по прайсу.
migrate((app) => {
  const c = app.findCollectionByNameOrId("drops");
  c.fields.add(new NumberField({ name: "old_price", min: 0 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("drops");
  c.fields.removeByName("old_price");
  app.save(c);
});
