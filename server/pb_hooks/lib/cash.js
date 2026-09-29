// Сверка кассы за день: что сайт посчитал оплаченным против того, что реально
// пришло в банк. Ловит любые расхождения с деньгами, а не только те, что уже
// случались. Заказ №3122 такая сверка показала бы на следующее утро:
// сайт насчитал на 5 299 ₽ больше, чем пришло.
const shop = require(`${__hooks}/lib/shop.js`);

const rub = (n) => shop.rub(Math.round(n));
const plural = (n, a, b, c) => { const m = n % 100, k = n % 10; return m >= 11 && m <= 14 ? c : k === 1 ? a : k >= 2 && k <= 4 ? b : c; };

// Границы московских суток в UTC: заказы храним по Гринвичу, банк считает по Москве.
function bounds(day) {
  const from = new Date(`${day}T00:00:00+03:00`);
  const to = new Date(from.getTime() + 24 * 3600 * 1000);
  const iso = (d) => d.toISOString();
  return { from: iso(from), to: iso(to) };
}

// Вчера по Москве
function yesterday() {
  const d = new Date(Date.now() + 3 * 3600 * 1000 - 24 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

// Сверка по одному терминалу
function forBrand(app, s, brand, day) {
  const pay = require(`${__hooks}/lib/pay.js`);
  const name = brand ? brand.get("name") : "магазин";

  const r = pay.cp(s, "/payments/list", { Date: day, TimeZone: "MSK" }, brand);
  if (!r.ok) return { name, error: r.error };
  const rows = (r.data && r.data.Model) || [];
  // тестовые платежи деньгами не являются — их и в кассе быть не должно
  const good = rows.filter((x) => (x.Status === "Completed" || x.Status === "Authorized") && !x.TestMode);
  const bankSum = good.reduce((a, x) => a + (+x.Amount || 0), 0);
  const bankByInvoice = {};
  good.forEach((x) => { bankByInvoice[String(x.InvoiceId || "")] = (bankByInvoice[String(x.InvoiceId || "")] || 0) + (+x.Amount || 0); });

  const b = bounds(day);
  let ours = [];
  try {
    ours = app.findRecordsByFilter("orders",
      `payment_status = "paid" && payment_method = "card" && paid_at >= {:from} && paid_at < {:to}`,
      "number", 500, 0, { from: b.from, to: b.to });
  } catch (err) { return { name, error: "не смог прочитать заказы: " + err }; }
  if (brand) ours = ours.filter((o) => String(o.get("brand") || "") === brand.id);
  const ourSum = ours.reduce((a, o) => a + (+o.get("total") || 0), 0);

  // Заказ отмечен оплаченным, а денег за этот счёт в банке нет — самое опасное.
  const пусто = ours.filter((o) => !bankByInvoice[shop.invoiceOf(o)]);

  // Терминал может обслуживать не только сайт: у «Гет Букет» там нашлись счета
  // 17121 и подобные — это чужая нумерация. Поэтому в обратную сторону смотрим
  // только на те счета, которым соответствует НАШ заказ: если деньги пришли, а
  // заказ не оплачен — мы проморгали оплату. Остальное просто считаем.
  const проморгали = [], чужие = [];
  let нашиВБанке = 0;
  Object.keys(bankByInvoice).forEach((inv) => {
    let o = null;
    // сначала по счёту с буквой витрины, потом по голому номеру — так у заказов,
    // оформленных до перехода на буквы
    try { o = app.findFirstRecordByFilter("orders", "invoice = {:i}", { i: inv }); } catch (_) {}
    if (!o && /^\d+$/.test(inv)) {
      try { o = app.findFirstRecordByFilter("orders", "number = {:n} && invoice = ''", { n: +inv }); } catch (_) {}
    }
    if (!o || (brand && String(o.get("brand") || "") !== brand.id)) { чужие.push(inv); return; }
    нашиВБанке += bankByInvoice[inv];
    if (o.get("payment_status") !== "paid") проморгали.push(o.get("number"));
  });
  const чужаяСумма = bankSum - нашиВБанке;

  return { name, bankSum: нашиВБанке, ourSum, count: ours.length,
    bankCount: good.length - чужие.length, пусто, проморгали,
    чужих: чужие.length, чужаяСумма };
}

// Отчёт по всем терминалам за день
function report(app, day) {
  const s = shop.settings(app);
  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true", "sort", 20, 0); } catch (_) {}
  const list = brands.length ? brands : [null];
  return list.map((b) => forBrand(app, s, b, day));
}

// Текст для служебного бота. Всё сошлось — одна короткая строка, чтобы не шуметь.
function text(day, parts) {
  const head = `🧾 Касса за ${day}`;
  const lines = parts.map((p) => {
    if (p.error) return `\n\n${p.name}: не смог сверить — ${p.error}`;
    const diff = Math.round(p.ourSum - p.bankSum);
    let t = `\n\n${p.name}: сайт ${rub(p.ourSum)} (${p.count}), банк ${rub(p.bankSum)} (${p.bankCount})`;
    const ровно = !diff && !p.пусто.length && !p.проморгали.length;
    if (diff) t += `\n❗ Расхождение ${rub(Math.abs(diff))} ${diff > 0 ? "в пользу сайта — деньги не пришли" : "в пользу банка"}`;
    if (p.пусто.length) t += `\n❗ Оплачены на сайте, но денег нет: ${p.пусто.map((o) => "№" + o.get("number")).join(", ")}`;
    if (p.проморгали.length) t += `\n⚠️ Деньги пришли, а заказ не оплачен: ${p.проморгали.map((n) => "№" + n).join(", ")}`;
    if (ровно) t += " — сходится ✅";
    // чужие платежи на том же терминале не считаем ошибкой, но упоминаем
    if (p.чужих) t += `\n(ещё ${p.чужих} ${plural(p.чужих, "платёж", "платежа", "платежей")} на ${rub(p.чужаяСумма)} — не с сайта)`;
    return t;
  });
  return head + lines.join("");
}

module.exports = { report, text, yesterday, bounds };
