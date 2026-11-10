// Партия Фридома: 6 000 стеблей 70 см по цене ниже каталожной.
// Отдельный прайс, а не правка «Колумбии»: на ней сидят и другие сорта,
// правка общей клетки уронила бы цену всем (та же причина, что у «Лидии»
// и «Ред Наоми»). Кончится партия — вернуть карточку на прайс tmvb2ad9i.
migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let т = [];
  try { т = JSON.parse(s.getString("price_tables") || "[]") || []; } catch (_) { т = []; }
  if (!т.some((x) => x.id === "freedom")) {
    т.push({
      id: "freedom", name: "Фридом 70 — партия",
      counts: [25, 51, 101, 201], def_count: 51,
      prices: { "70": { "25": 3990, "51": 6990, "101": 11990, "201": 22990 } },
    });
    app.db().newQuery("UPDATE settings SET price_tables = {:v} WHERE id = {:id}")
      .bind({ v: JSON.stringify(т), id: s.id }).execute();
  }
  // Карточка «Роза Фридом»: свой прайс, настоящий остаток и надпись партии.
  // Остаток включаем намеренно — без него счётчик свободных стеблей врал бы,
  // а продажа не остановилась бы, когда партия кончится.
  app.db().newQuery(`UPDATE products SET price_table = 'freedom', stock = '{"70": 6000}',
      batch_total = 6000, batch_note = 'Привезли для вас 6 000 роз Фридом'
    WHERE id = 'lploh076pnut27y'`).execute();
}, (app) => {
  app.db().newQuery(`UPDATE products SET price_table = 'tmvb2ad9i', stock = '{}',
      batch_total = 0, batch_note = '' WHERE id = 'lploh076pnut27y'`).execute();
});
