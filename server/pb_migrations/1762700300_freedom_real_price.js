// Цены партии — настоящие, с карточки (решение владельца): прайс «Колумбия»,
// 25/51/101 за 4 990 / 8 990 / 15 990. Отдельный прайс со скидкой не нужен:
// «по лучшей цене» здесь про оптовую цену от производителя, а не про скидку.
migrate((app) => {
  app.db().newQuery("UPDATE products SET price_table = 'tmvb2ad9i' WHERE id = 'lploh076pnut27y'").execute();
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let т = [];
  try { т = JSON.parse(s.getString("price_tables") || "[]") || []; } catch (_) { т = []; }
  const без = т.filter((x) => x.id !== "freedom");
  if (без.length !== т.length) {
    app.db().newQuery("UPDATE settings SET price_tables = {:v} WHERE id = {:id}")
      .bind({ v: JSON.stringify(без), id: s.id }).execute();
  }
}, (app) => {
  app.db().newQuery("UPDATE products SET price_table = 'freedom' WHERE id = 'lploh076pnut27y'").execute();
});
