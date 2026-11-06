/// <reference path="../pb_data/types.d.ts" />
// Индекс рекомендации отдельной вкладкой и в разрезе витрин.
//
// Оценка живёт в reviews, а витрина — в заказе, поэтому считаем через связь
// review.order → orders.brand. Молчунов в индекс не берём: по ним ничего не
// известно, и они утопили бы любую цифру.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё внутри.

routerAdd("GET", "/api/shop/nps", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head", "manager", "care"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const days = Math.min(365, Math.max(7, +q.get("days") || 30));
  const от = new Date(Date.now() + 3 * 3600e3 - (days - 1) * 864e5).toISOString().slice(0, 10);

  // Витрина каждого заказа: один проход, чтобы не дёргать базу на каждую оценку
  const витрина = {}, имя = { "": "без витрины" };
  try {
    $app.findRecordsByFilter("brands", "id != ''", "sort", 20, 0).forEach((b) => { имя[b.id] = b.get("name") || b.get("slug"); });
  } catch (_) {}
  try {
    const rows = arrayOf(new DynamicModel({ id: "", brand: "" }));
    $app.db().newQuery("SELECT id, brand FROM orders WHERE created > {:f}").bind({ f: от + " 00:00:00" }).all(rows);
    rows.forEach((r) => { витрина[r.id] = r.brand || ""; });
  } catch (err) { console.log("nps: витрины", err); }

  const пусто = () => ({ спросили: 0, ответили: 0, промоутеры: 0, нейтральные: 0, критики: 0, сумма: 0, словами: 0, звонки: 0 });
  const всего = пусто(), поВитринам = {}, поНеделям = {};
  const слова = [];

  let список = [];
  try { список = $app.findRecordsByFilter("reviews", "created >= {:f}", "-created", 2000, 0, { f: от + " 00:00:00" }); }
  catch (err) { return e.json(500, { message: String(err) }); }

  список.forEach((r) => {
    const bid = витрина[String(r.get("order") || "")] || "";
    const b = (поВитринам[bid] = поВитринам[bid] || пусто());
    const день = r.getString("created").slice(0, 10);
    // неделя — понедельник этой даты
    const d = new Date(день + "T12:00:00Z");
    const пн = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    const w = (поНеделям[пн] = поНеделям[пн] || пусто());

    [всего, b, w].forEach((x) => x.спросили++);
    const n = +r.get("nps") || 0;
    if (n > 0) {
      [всего, b, w].forEach((x) => {
        x.ответили++; x.сумма += n;
        if (n >= 9) x.промоутеры++; else if (n >= 7) x.нейтральные++; else x.критики++;
      });
    }
    const текст = String(r.get("comment") || "").trim();
    if (текст) {
      [всего, b, w].forEach((x) => x.словами++);
      if (слова.length < 60) слова.push({ at: r.getString("created").slice(0, 10), nps: n || null, text: текст.slice(0, 400), brand: имя[bid] || "" });
    }
    if (r.get("needs_call") && !r.get("handled")) [всего, b, w].forEach((x) => x.звонки++);
  });

  const свести = (x) => ({
    спросили: x.спросили, ответили: x.ответили,
    доля: x.спросили ? Math.round(x.ответили * 1000 / x.спросили) / 10 : 0,
    средняя: x.ответили ? Math.round(x.сумма * 10 / x.ответили) / 10 : 0,
    промоутеры: x.промоутеры, нейтральные: x.нейтральные, критики: x.критики,
    индекс: x.ответили ? Math.round((x.промоутеры - x.критики) * 100 / x.ответили) : null,
    словами: x.словами, звонки: x.звонки,
  });

  return e.json(200, {
    от, days,
    итого: свести(всего),
    витрины: Object.keys(поВитринам).map((k) => Object.assign({ brand: имя[k] || "без витрины" }, свести(поВитринам[k])))
      .sort((a, b) => b.ответили - a.ответили),
    недели: Object.keys(поНеделям).sort().map((k) => Object.assign({ week: k }, свести(поНеделям[k]))),
    слова,
  });
}, $apis.requireAuth("managers"));
