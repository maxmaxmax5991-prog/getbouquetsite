// Запись ошибок в табло админки.
// Складываем одинаковые в одну строку: важно «что сломалось и сколько раз»,
// а не сто одинаковых записей подряд.
function note(app, place, text, ctx) {
  try {
    const t = String(text || "").slice(0, 600);
    if (!t) return;
    // ключ без цифр: «заказ 3026» и «заказ 3027» — одна и та же беда
    const key = (String(place) + "|" + t.replace(/\d+/g, "#")).slice(0, 300);
    const now = new Date().toISOString();
    app.db().newQuery(`INSERT INTO errors (key, place, text, ctx, count, first_at, last_at, fixed)
      VALUES ({:k}, {:p}, {:t}, {:c}, 1, {:n}, {:n}, 0)
      ON CONFLICT(key) DO UPDATE SET count = count + 1, last_at = {:n}, text = {:t}, ctx = {:c}, fixed = 0`)
      .bind({ k: key, p: String(place).slice(0, 40), t, c: String(ctx || "").slice(0, 300), n: now }).execute();
  } catch (e) {
    console.log("не записал ошибку", e);
  }
}
module.exports = { note };
