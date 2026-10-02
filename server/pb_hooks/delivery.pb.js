/// <reference path="../pb_data/types.d.ts" />
// Поставки накладными. Вся работа — в lib/delivery.js: обработчики PocketBase
// не видят код верхнего уровня этого файла, всё нужное подключаем внутри.

// Список накладных для админки: что едет и что уже пришло
routerAdd("GET", "/api/shop/deliveries", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  let list = [];
  try { list = $app.findRecordsByFilter("deliveries", "id != ''", "-created", 100, 0); } catch (_) {}
  const имена = {};
  try { $app.findRecordsByFilter("products", "id != ''", "", 500, 0).forEach((p) => { имена[p.id] = p.get("name"); }); } catch (_) {}
  return e.json(200, { rows: list.map((d) => ({
    id: d.id, supplier: d.get("supplier"), at: d.get("at"), note: d.get("note") || "",
    done: !!d.get("done"), done_at: d.get("done_at") || "",
    lines: (shop.jget(d, "lines") || []).map((l) => Object.assign({}, l, { name: имена[l.product] || l.name || "—" })),
  })) });
}, $apis.requireAuth("managers"));

// Завести или поправить накладную
routerAdd("POST", "/api/shop/delivery", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  let d;
  if (b.id) {
    try { d = $app.findRecordById("deliveries", String(b.id)); } catch (_) { return e.json(404, { message: "Накладная не найдена" }); }
  } else {
    d = new Record($app.findCollectionByNameOrId("deliveries"));
  }
  if (b.supplier !== undefined) d.set("supplier", String(b.supplier || "").slice(0, 120));
  if (b.note !== undefined) d.set("note", String(b.note || "").slice(0, 300));
  if (b.at !== undefined) {
    const at = String(b.at || "").trim();
    if (at && !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) return e.json(400, { message: "Время привоза: ГГГГ-ММ-ДД ЧЧ:ММ" });
    d.set("at", at);
  }
  if (Array.isArray(b.lines)) {
    d.set("lines", b.lines.map((l) => ({
      product: String(l.product || ""), len: String(l.len || ""), qty: Math.max(0, Math.round(+l.qty || 0)),
    })).filter((l) => l.product && l.qty));
  }
  if (!d.get("supplier")) return e.json(400, { message: "Укажите поставщика" });
  $app.save(d);
  require(`${__hooks}/lib/delivery.js`).пересчитать($app);
  return e.json(200, { ok: true, id: d.id });
}, $apis.requireAuth("managers"));

// «Приехало»: всё из накладной прибавляем к остаткам одним нажатием
routerAdd("POST", "/api/shop/delivery-arrive", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  let d;
  try { d = $app.findRecordById("deliveries", String(b.id || "")); } catch (_) { return e.json(404, { message: "Накладная не найдена" }); }
  if (d.get("done")) return e.json(400, { message: "Эта накладная уже отмечена привезённой." });
  const r = require(`${__hooks}/lib/delivery.js`).привезли($app, d);
  return e.json(200, Object.assign({ ok: true }, r));
}, $apis.requireAuth("managers"));

// Удалить накладную целиком
routerAdd("POST", "/api/shop/delivery-del", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  try { $app.delete($app.findRecordById("deliveries", String(b.id || ""))); } catch (_) { return e.json(404, { message: "Накладная не найдена" }); }
  require(`${__hooks}/lib/delivery.js`).пересчитать($app);
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
