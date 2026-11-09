// Формы из цветов: сердце и буквы. Это не корзина — каркас вместо основы,
// цветы те же и берутся из общего количества. Пороги и цены правит владелец.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.add(new JSONField({ name: "basket_shapes", maxSize: 20000 }));
  app.save(c);
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  if (s) {
    app.db().newQuery("UPDATE settings SET basket_shapes = {:v} WHERE id = {:id}").bind({
      // Решение владельца 09.11.2026: сердце от 150 роз за 1 000 ₽,
      // одна буква от 200, три от 301, пять от 501, каждая по 1 000 ₽.
      v: JSON.stringify({
        heart: { name: "Сердце", price: 1000, from: 150 },
        letter_price: 1000,
        letters: [{ max: 1, from: 200 }, { max: 3, from: 301 }, { max: 5, from: 501 }],
      }),
      id: s.id,
    }).execute();
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("basket_shapes");
  app.save(c);
});
