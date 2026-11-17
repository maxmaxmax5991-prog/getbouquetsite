/// <reference path="../pb_data/types.d.ts" />
// Владелец 17.11.2026: запустить сейчас 30 букетов Фрутти Баблз,
// 40 см, 25 стеблей за 2 990 рублей. Дроп использует обычную отправку
// в МойСклад: label 40-25 -> quantity 25, цена стебля 119,60 руб.
// Каталожные цены и остатки не меняем: цветы на дроп выделены отдельно.
migrate((app) => {
  const day = "2026-11-17";
  const now = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  if (now.slice(0, 10) !== day) {
    console.log("frutti drop: skipped outside requested date");
    return;
  }
  // Не заменять дроп, который могли уже запустить другим способом.
  let existing = null;
  try { existing = app.findFirstRecordByFilter("drops", "date = {:d}", { d: day }); } catch (_) {}
  if (existing) { console.log("frutti drop: existing date preserved"); return; }

  let product = null;
  try { product = app.findRecordById("products", "fruttibablz001"); } catch (_) {}
  if (!product || product.get("name") !== "Фрутти Баблз") {
    console.log("frutti drop: product not verified; not publishing");
    return;
  }
  let lengths = [], pick = {};
  try { lengths = JSON.parse(product.getString("lengths") || "[]"); } catch (_) {}
  try { pick = JSON.parse(product.getString("ms_pick") || "{}"); } catch (_) {}
  if (!Array.isArray(lengths) || !lengths.map(Number).includes(40)) {
    console.log("frutti drop: 40cm not configured; not publishing");
    return;
  }
  // Не допустить списания одного готового букета вместо 25 стеблей.
  const mapping = pick["40"] || pick["40-25"];
  if (mapping && mapping.whole) {
    console.log("frutti drop: whole-bouquet mapping; not publishing");
    return;
  }
  const d = new Record(app.findCollectionByNameOrId("drops"));
  d.set("date", day);
  d.set("start_at", day + " " + now.slice(11, 16));
  // Штатное время готовности дропа; запуск владельцем подтверждён после 15 МСК.
  d.set("ready_at", day + " 15:00");
  d.set("len", 40);
  d.set("cnt", 25);
  d.set("price", 2990);
  d.set("old_price", 0);
  d.set("note", "25 кустовых роз Фрутти Баблз");
  d.set("lots", [{ product: product.id, qty: 30, left: 30 }]);
  d.set("active", true);
  app.save(d);
}, (app) => {
  // Исторические дропы и связанные заказы при откате не удаляем.
});
