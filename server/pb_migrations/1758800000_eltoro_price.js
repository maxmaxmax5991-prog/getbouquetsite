/// <reference path="../pb_data/types.d.ts" />
// Возврат цены после проверки оплаты: 40 см × 25 стоит 2490 ₽, а не 500 ₽.
// 500 ₽ ставили, чтобы пробовать оплату настоящей картой на маленькую сумму.
// Меняем только если там до сих пор тестовые 500 — чтобы не затереть осознанную правку.
const WAS = 500, NOW = 2490;

migrate((app) => {
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  let tables;
  try { tables = JSON.parse(rec.getString("price_tables") || "[]"); } catch (_) { return; }
  if (!Array.isArray(tables)) return;
  let changed = false;
  tables.forEach((t) => {
    if (t.id !== "single" || !t.prices || !t.prices["40"]) return;
    if (+t.prices["40"]["25"] === WAS) { t.prices["40"]["25"] = NOW; changed = true; }
  });
  if (!changed) { console.log("Эльторо 40×25: тестовой цены нет, ничего не меняем"); return; }
  rec.set("price_tables", tables);
  app.save(rec);
  console.log(`Эльторо 40×25: ${WAS} → ${NOW} ₽`);
}, (app) => {
  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  let tables;
  try { tables = JSON.parse(rec.getString("price_tables") || "[]"); } catch (_) { return; }
  tables.forEach((t) => {
    if (t.id === "single" && t.prices && t.prices["40"] && +t.prices["40"]["25"] === NOW) t.prices["40"]["25"] = WAS;
  });
  rec.set("price_tables", tables);
  app.save(rec);
});
