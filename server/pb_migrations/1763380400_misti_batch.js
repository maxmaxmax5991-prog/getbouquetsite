/// <reference path="../pb_data/types.d.ts" />
// 17.11.2026: партия Мисти 40 см, 1200 стеблей, цены владельца.
// Отдельный прайс меняет только этот сорт; Фрутти/Фридом не затрагиваем.
migrate((app) => {
  const p = app.findRecordById("products", "oghyzgr5n0kdnc1");
  if (p.get("name") !== "Мисти Баблз") { console.log("misti batch: name mismatch"); return; }
  if (+p.get("batch_total") > 0) { console.log("misti batch: existing batch preserved"); return; }
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  const tables = JSON.parse(s.getString("price_tables") || "[]");
  const tableId = "misti-batch-20261117";
  if (tables.some((t) => t.id === tableId)) { console.log("misti batch: existing price preserved"); return; }
  tables.push({ id: tableId, name: "Мисти Баблз 40 — партия 1200",
    counts: [21, 51, 101], def_count: 21,
    prices: { "40": { "21": 2990, "51": 6990, "101": 13990 } } });
  app.db().newQuery("UPDATE settings SET price_tables = {:tables} WHERE id = {:id}")
    .bind({ tables: JSON.stringify(tables), id: s.id }).execute();
  // Штатная механика запуска партии: остаток становится объявленным запасом.
  // Только 40 см имеет цену в прайсе партии; остальные ростовки не продаём.
  app.db().newQuery(`UPDATE products SET price_table = {:price}, batch_prev_table = {:previous},
    stock = {:stock}, no_stock = false, batch_total = 1200, batch_note = {:note}
    WHERE id = {:id}`)
    .bind({ price: tableId, previous: p.get("price_table") || "",
      stock: JSON.stringify({ "40": 1200 }),
      note: "Привезли для вас 1 200 роз Мисти Баблз", id: p.id }).execute();
}, (app) => {
  // Не восстанавливать прежние остатки вслепую: после старта могли быть продажи.
  // Остановить через «Партии» в админке, она вернёт batch_prev_table.
});
