// Спрос по витринам: сколько раз сорт купили ИМЕННО на этом сайте.
//
// Нужно, чтобы плитка на каждой витрине шла в своём порядке. Аудитории разные:
// на venikoff.net чаще берут Лидию 60/51 и дроп, у Гет Букета — Кейтлин 40/19 и
// Ред Наоми 101. Общий порядок одинаково неудобен обоим.
//
// Считаем заказы за 30 дней, свежую неделю берём с тройным весом: витрина должна
// реагировать на то, что покупают сейчас, но не дёргаться от одного дня.
// Балл кладём в products.rank_by = {"<id витрины>": балл} запросом, мимо хуков:
// обычное сохранение товара затирает соседние поля из устаревшей копии.
const ДНЕЙ = 30;
const СВЕЖИХ = 7;
const ВЕС_СВЕЖИХ = 3;

function пересчитать(app) {
  const баллы = {};        // id товара → { id витрины: балл }
  let строк = 0;
  try {
    const rows = arrayOf(new DynamicModel({ brand: "", items: "", fresh: 0 }));
    app.db().newQuery(`
      SELECT brand, items,
        CASE WHEN created > datetime('now', '-${СВЕЖИХ} days') THEN 1 ELSE 0 END AS fresh
      FROM orders
      WHERE status != 'cancelled' AND brand != '' AND created > datetime('now', '-${ДНЕЙ} days')`).all(rows);
    rows.forEach((r) => {
      let items = [];
      try { items = JSON.parse(String(r.items || "[]")) || []; } catch (_) { return; }
      const вес = r.fresh ? ВЕС_СВЕЖИХ : 1;
      items.forEach((it) => {
        const pid = String((it && it.id) || "");
        if (!pid) return;
        баллы[pid] = баллы[pid] || {};
        баллы[pid][r.brand] = (баллы[pid][r.brand] || 0) + вес;
        строк++;
      });
    });
  } catch (err) { console.log("спрос: не прочитал заказы", err); return { ok: false, error: String(err) }; }

  let товаров = 0;
  try {
    app.findRecordsByFilter("products", "id != ''", "", 2000, 0).forEach((p) => {
      const было = String(p.getString("rank_by") || "{}");
      const стало = JSON.stringify(баллы[p.id] || {});
      if (было === стало) return;
      app.db().newQuery("UPDATE products SET rank_by = {:v} WHERE id = {:id}").bind({ v: стало, id: p.id }).execute();
      товаров++;
    });
  } catch (err) { console.log("спрос: не записал", err); return { ok: false, error: String(err) }; }
  return { ok: true, позиций: строк, товаров };
}

module.exports = { пересчитать, ДНЕЙ };
