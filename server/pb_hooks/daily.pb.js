/// <reference path="../pb_data/types.d.ts" />
// Сводка по дням: одна строка на день, чтобы видеть динамику, а не только «итого».
// Дни московские: заказ, оформленный в час ночи, относится к ночи, а не к
// предыдущему дню по Гринвичу.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное внутри.

routerAdd("GET", "/api/shop/daily", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const days = Math.min(120, Math.max(2, +q.get("days") || 30));
  const bid = String(q.get("brand") || "").trim();
  const от = new Date(Date.now() + 3 * 3600e3 - (days - 1) * 864e5).toISOString().slice(0, 10);
  const до = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);

  const карта = {};
  const день = (d) => (карта[d] = карта[d] || { day: d, заказов: 0, отменено: 0, живых: 0, выручка: 0,
    картой: 0, ждут: 0, доставка: 0, ваз: 0, дроп: 0, корзин: 0,
    гостей: 0, карточек: 0, корзина: 0, оформление: 0, фотоЖдёт: 0, фотоПоправить: 0 });
  for (let i = 0; i < days; i++) день(new Date(Date.now() + 3 * 3600e3 - i * 864e5).toISOString().slice(0, 10));

  const только = bid ? " AND brand = {:b}" : "";
  const арг = bid ? { f: от, t: до, b: bid } : { f: от, t: до };

  // --- заказы: один проход по таблице ---
  try {
    const rows = arrayOf(new DynamicModel({ day: "", всего: 0, отменено: 0, живых: 0, выручка: 0,
      картой: 0, ждут: 0, доставка: 0, ваз: 0, дроп: 0, корзин: 0, фотоЖдёт: 0, фотоПоправить: 0 }));
    $app.db().newQuery(`
      SELECT date(created, '+3 hours') AS day,
        COUNT(*) AS всего,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS отменено,
        SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS живых,
        SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS выручка,
        SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS картой,
        SUM(CASE WHEN payment_method = 'card' AND payment_status != 'paid' AND status != 'cancelled' THEN 1 ELSE 0 END) AS ждут,
        SUM(CASE WHEN status != 'cancelled' THEN delivery_price ELSE 0 END) AS доставка,
        SUM(CASE WHEN status != 'cancelled' AND (items LIKE '%Ваза%' OR items LIKE '%ваза%') THEN 1 ELSE 0 END) AS ваз,
        SUM(CASE WHEN status != 'cancelled' AND drop_q != '' THEN 1 ELSE 0 END) AS дроп,
        SUM(CASE WHEN status != 'cancelled' AND items LIKE '%"kind":"basket"%' THEN 1 ELSE 0 END) AS корзин,
        SUM(CASE WHEN photo_status = 'waiting' THEN 1 ELSE 0 END) AS фотоЖдёт,
        SUM(CASE WHEN photo_status = 'rework' THEN 1 ELSE 0 END) AS фотоПоправить
      FROM orders
      WHERE date(created, '+3 hours') >= {:f} AND date(created, '+3 hours') <= {:t}${только}
      GROUP BY day`).bind(арг).all(rows);
    rows.forEach((r) => {
      const d = день(r.day);
      d.заказов = +r.всего; d.отменено = +r.отменено; d.живых = +r.живых;
      d.выручка = Math.round(+r.выручка); d.картой = +r.картой; d.ждут = +r.ждут;
      d.доставка = Math.round(+r.доставка); d.ваз = +r.ваз; d.дроп = +r.дроп; d.корзин = +r.корзин;
      d.фотоЖдёт = +r.фотоЖдёт; d.фотоПоправить = +r.фотоПоправить;
    });
  } catch (err) { console.log("сводка по дням: заказы", err); }

  // --- посетители ---
  try {
    const rows = arrayOf(new DynamicModel({ day: "", n: 0 }));
    $app.db().newQuery(`SELECT day, COUNT(*) AS n FROM visits WHERE day >= {:f} AND day <= {:t}${только} GROUP BY day`)
      .bind(арг).all(rows);
    rows.forEach((r) => { день(r.day).гостей = +r.n; });
  } catch (err) { console.log("сводка по дням: посетители", err); }

  // --- шаги пути: карточка → корзина → оформление ---
  try {
    const rows = arrayOf(new DynamicModel({ day: "", kind: "", n: 0 }));
    $app.db().newQuery(`SELECT day, kind, COUNT(DISTINCT vid) AS n FROM events
      WHERE day >= {:f} AND day <= {:t} AND kind IN ('view','cart','checkout')${только} GROUP BY day, kind`)
      .bind(арг).all(rows);
    rows.forEach((r) => {
      const d = день(r.day);
      if (r.kind === "view") d.карточек = +r.n;
      else if (r.kind === "cart") d.корзина = +r.n;
      else if (r.kind === "checkout") d.оформление = +r.n;
    });
  } catch (err) { console.log("сводка по дням: шаги", err); }

  // --- по витринам: выручка и заказы каждого сайта за день ---
  const витрины = {};
  try {
    const имя = {};
    $app.findRecordsByFilter("brands", "id != ''", "sort", 20, 0).forEach((b) => { имя[b.id] = b.get("name") || b.get("slug"); });
    const rows = arrayOf(new DynamicModel({ day: "", brand: "", n: 0, сумма: 0 }));
    $app.db().newQuery(`
      SELECT date(created, '+3 hours') AS day, brand, COUNT(*) AS n, SUM(total) AS сумма
      FROM orders
      WHERE date(created, '+3 hours') >= {:f} AND date(created, '+3 hours') <= {:t} AND status != 'cancelled'
      GROUP BY day, brand`).bind({ f: от, t: до }).all(rows);
    rows.forEach((r) => {
      const k = имя[r.brand] || "без витрины";
      витрины[k] = витрины[k] || {};
      витрины[k][r.day] = { заказов: +r.n, выручка: Math.round(+r.сумма) };
    });
  } catch (err) { console.log("сводка по дням: витрины", err); }

  const список = Object.keys(карта).sort().map((k) => карта[k]);
  список.forEach((d) => {
    d.чек = d.живых ? Math.round(d.выручка / d.живых) : 0;
    d.конверсия = d.гостей ? Math.round(d.живых * 1000 / d.гостей) / 10 : 0;
    d.довели = d.оформление ? Math.round(d.живых * 1000 / d.оформление) / 10 : 0;
  });
  return e.json(200, { days: список, brands: витрины, from: от, to: до });
}, $apis.requireAuth("managers"));

// Утренняя сводка в Телеграм: вчерашний день против позавчера и против того же
// дня недели неделю назад — чтобы видеть не только «больше/меньше», но и
// недельный ритм (суббота всегда выше среды, и это не рост).
cronAdd("daily-digest", "0 7 * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  if (!s.get("digest_off")) require(`${__hooks}/lib/digest.js`).отправить($app, s);
});

// Прислать сводку сейчас — кнопкой из админки
routerAdd("POST", "/api/shop/digest-now", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const s = shop.settings($app);
  const r = require(`${__hooks}/lib/digest.js`).отправить($app, s);
  return e.json(200, { ok: true, text: r.text, кому: r.кому });
}, $apis.requireAuth("managers"));
