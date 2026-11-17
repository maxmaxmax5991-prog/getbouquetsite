/// <reference path="../pb_data/types.d.ts" />
// Приход по счёту КФ-6571 от 17.11.2026. Закупочные цены в розничный прайс не переносим.
// Принц Персии 40 см 600 шт исключён владельцем. Остальные 9050 стеблей — приход.
migrate((app) => {
  const del = require(`${__hooks}/lib/delivery.js`);
  const shop = require(`${__hooks}/lib/shop.js`);
  const supplier = "Калужский цветочный холдинг, КФ-6571 от 17.11.2026";
  const rows = [
    ["dv7yttgtdop0bl2", "Пич Аваланж", 40, 525],
    ["8a6g6vj1v6461rw", "Пинк Аваланж", 40, 225],
    ["8a6g6vj1v6461rw", "Пинк Аваланж", 50, 525],
    ["8a6g6vj1v6461rw", "Пинк Аваланж", 60, 525],
    ["1zo659oeaqhpim9", "Аваланж", 40, 720],
    ["pccrnsyw8mx1koy", "Эльторо", 40, 540],
    ["vwfe1eln5tatfaa", "Абигейл", 40, 450],
    ["xrumitkazb3ebhe", "Космик", 40, 450],
    ["8l6d3uhseix9ceb", "Свит Аваланж", 40, 600],
    ["8l6d3uhseix9ceb", "Свит Аваланж", 50, 1320],
    ["agau1xrxxnjvpdc", "Кейтлин", 40, 480],
    ["il8csmsafamwlns", "Свит Фортун", 40, 140],
    ["hzqahkkdrynu882", "Эксклюзив Сенсейшен", 40, 490],
    ["lrmpdyb1r3xorap", "Беларусь", 40, 420],
    ["lrmpdyb1r3xorap", "Беларусь", 50, 120],
    ["yqwx9l2h6i1go69", "Ред Баблз", 40, 380],
    ["oghyzgr5n0kdnc1", "Мисти Баблз", 40, 300],
    ["2ubrv55zfxwuepo", "Супер Сенсейшен", 40, 80],
    ["2ubrv55zfxwuepo", "Супер Сенсейшен", 50, 600],
    ["", "Корал Йо-Йо", 40, 160],
  ];
  const all = app.findRecordsByFilter("products", "id != ''", "", 1000, 0);
  const norm = x => String(x || "").toLowerCase().replace(/ё/g, "е").replace(/[^а-яa-z0-9]/g, "");
  const coral = all.filter(p => [p.get("name"), p.get("ms_name")].some(v => {
    const n = norm(v); return n.indexOf("корал") >= 0 && n.indexOf("йо") >= 0;
  }));
  const unknown = [];
  if (coral.length !== 1) unknown.push({ name: "Корал Йо-Йо", candidates: coral.map(p => ({ id: p.id, name: p.get("name") })) });
  else rows[rows.length - 1][0] = coral[0].id;
  const products = {};
  rows.filter(x => x[0]).forEach(x => {
    const p = all.find(p => p.id === x[0]);
    if (!p) unknown.push({ name: x[1], id: x[0] });
    else products[p.id] = p;
  });
  if (unknown.length) {
    console.log("receipt-6571 " + JSON.stringify({ event: "needs-mapping", unknown,
      nearby: all.filter(p => /йо|корал/i.test(String(p.get("name")) + " " + String(p.get("ms_name"))))
        .map(p => ({ id: p.id, name: p.get("name"), ms_name: p.get("ms_name") })) }));
    return; // Не проводить частично, не создавать карточки-дубли и не ломать запуск.
  }
  let existing = null;
  try { existing = app.findFirstRecordByFilter("deliveries", "supplier ~ {:invoice}", { invoice: "КФ-6571" }); } catch (_) {}
  if (existing) { console.log("receipt-6571 " + JSON.stringify({ event: "already-recorded", id: existing.id, done: existing.get("done") })); return; }
  // Проверяем длины и цены до проведения: ненастроенная ростовка не должна исчезнуть с витрины.
  const tables = shop.priceTables(shop.settings(app));
  const unpriced = rows.filter(x => {
    const p = products[x[0]], t = tables.find(t => t.id === p.get("price_table"));
    return !t || !Object.values((t.prices || {})[String(x[2])] || {}).some(v => +v > 0);
  });
  if (unpriced.length) { console.log("receipt-6571 " + JSON.stringify({ event: "missing-price", rows: unpriced })); return; }
  Object.keys(products).forEach(id => {
    const p = products[id], lengths = shop.jget(p, "lengths") || [];
    const merged = Array.from(new Set(lengths.map(Number).concat(rows.filter(x => x[0] === id).map(x => x[2])))).sort((a,b) => a-b);
    app.db().newQuery("UPDATE products SET active = true, lengths = {:lengths} WHERE id = {:id}")
      .bind({ lengths: JSON.stringify(merged), id }).execute();
  });
  const d = new Record(app.findCollectionByNameOrId("deliveries"));
  const stamp = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
  const now = { date: stamp.slice(0, 10), minutes: +stamp.slice(11, 13) * 60 + +stamp.slice(14, 16) };
  d.set("supplier", supplier); d.set("at", now.date + " " + String(Math.floor(now.minutes / 60)).padStart(2,"0") + ":" + String(now.minutes % 60).padStart(2,"0"));
  d.set("note", "Приход подтверждён владельцем; Принц Персии 40 см 600 шт исключён. Итого 9050 стеблей.");
  d.set("lines", rows.map(x => ({ product: x[0], name: x[1], len: String(x[2]), qty: x[3] })));
  app.save(d);
  const result = del.привезли(app, d);
  console.log("receipt-6571 " + JSON.stringify({ event: "received", id: d.id, result, rows: rows.map(x=>({id:x[0],name:x[1],len:x[2],qty:x[3]})) }));
  // «Сегодня с теплицы» у роз; исключаем французские/эквадорские и прайсы Колумбии.
  const cats = app.findRecordsByFilter("categories", "id != ''", "", 200, 0);
  let fresh = 0;
  all.forEach(p => {
    const c = cats.find(c => c.id === p.get("category"));
    if (!c || !/роз/i.test(String(c.get("name"))) || p.get("is_express")) return;
    const slug = String(c.get("slug") || "");
    const table = tables.find(t => t.id === p.get("price_table"));
    const foreign = /french|ecuador/.test(slug) || /колумб|colombia|эквадор|ecuador|франц/i.test(
      String(p.get("name") || "") + " " + String(table && table.name || "") + " " + String(p.get("badge_text") || ""));
    if (foreign) return;
    app.db().newQuery("UPDATE products SET fresh_date = {:date} WHERE id = {:id}")
      .bind({ date: shop.moscowToday(), id: p.id }).execute();
    fresh++;
  });
  console.log("receipt-6571 " + JSON.stringify({ event: "fresh-marked", products: fresh }));
}, (app) => { /* Фактический приход не вычитаем при откате кода. */ });
