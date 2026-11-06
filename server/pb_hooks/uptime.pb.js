/// <reference path="../pb_data/types.d.ts" />
// Контроль доступности сайта. Раз в минуту дёргаем магазин теми же путями,
// какими до него идёт покупатель, и записываем ответ. Три неудачи подряд —
// сообщение в служебный бот, выздоровление — тоже.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё внутри.

// Самая дешёвая страница, по которой видно, что живы и сервер, и база.
// Нужна отдельно: тянуть каталог раз в минуту ради проверки расточительно.
routerAdd("GET", "/api/shop/ping", (e) => {
  let база = false;
  try {
    const row = new DynamicModel({ n: 0 });
    $app.db().newQuery("SELECT COUNT(*) AS n FROM settings").one(row);
    база = +row.n > 0;
  } catch (_) {}
  e.response.header().set("Cache-Control", "no-store");
  return e.json(база ? 200 : 503, { ok: база });
});

cronAdd("uptime", "* * * * *", () => {
  try { require(`${__hooks}/lib/uptime.js`).проверить($app); }
  catch (err) { console.log("доступность", err); }
});

// Сводка для админки
routerAdd("GET", "/api/shop/uptime", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const up = require(`${__hooks}/lib/uptime.js`);
  const часов = Math.min(720, Math.max(1, +q.get("hours") || 24));
  // последние провалы — чтобы видеть не только процент, но и когда именно
  const провалы = [];
  try {
    const rows = arrayOf(new DynamicModel({ target: "", code: 0, note: "", created: "" }));
    $app.db().newQuery(`SELECT target, code, note, created FROM uptime
      WHERE ok = 0 AND created > {:f} ORDER BY created DESC LIMIT 30`)
      .bind({ f: new Date(Date.now() - часов * 3600e3).toISOString().replace("T", " ").slice(0, 23) + "Z" }).all(rows);
    rows.forEach((r) => провалы.push({ target: r.target, code: r.code, note: r.note, at: r.created }));
  } catch (_) {}
  return e.json(200, { часов, цели: up.сводка($app, часов), провалы });
}, $apis.requireAuth("managers"));

// Проверить прямо сейчас — кнопкой из админки
routerAdd("POST", "/api/shop/uptime-now", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  return e.json(200, { строки: require(`${__hooks}/lib/uptime.js`).проверить($app) });
}, $apis.requireAuth("managers"));
