/// <reference path="../pb_data/types.d.ts" />
// Владелец подтвердил: вернуть доступный остаток Мисти 40 см к 1200 стеблям.
migrate((app) => {
  const p = app.findRecordById("products", "oghyzgr5n0kdnc1");
  const before = p.getString("stock") || "{}";
  console.log("misti-stock-audit " + JSON.stringify({ event: "before-restore",
    stock: before, updated: p.get("updated"), table: p.get("price_table"), at: new Date().toISOString() }));
  // Только одна ростовка; остальные свойства товара и продажи не перезаписываем.
  app.db().newQuery("UPDATE products SET stock = json_set(CASE WHEN json_valid(stock) AND json_type(stock) = 'object' THEN stock ELSE '{}' END, '$.40', 1200) WHERE id = {:id}")
    .bind({ id: p.id }).execute();
  console.log("misti-stock-audit " + JSON.stringify({ event: "restored", cm40: 1200, at: new Date().toISOString() }));
}, (app) => {});
