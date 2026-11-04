// Утренняя сводка владельцу: один день против двух опорных — вчерашнего и того
// же дня недели неделю назад. Без второго сравнения любая суббота читается как
// рост, а любой вторник — как провал.
const shop = require(`${__hooks}/lib/shop.js`);

const МЕС = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
  "августа", "сентября", "октября", "ноября", "декабря"];
const ДНИ = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"];

function мскДень(сдвиг) {
  return new Date(Date.now() + 3 * 3600e3 + (сдвиг || 0) * 864e5).toISOString().slice(0, 10);
}

// Все числа одного дня. Один запрос по заказам, по одному — по посетителям и шагам.
function сутки(app, day) {
  const d = { day, заказов: 0, отменено: 0, живых: 0, выручка: 0, картой: 0, ждут: 0,
    ваз: 0, дроп: 0, корзин: 0, гостей: 0, оформление: 0, фотоЖдёт: 0 };
  try {
    const row = new DynamicModel({ всего: 0, отменено: 0, живых: 0, выручка: 0, картой: 0, ждут: 0,
      ваз: 0, дроп: 0, корзин: 0, фотоЖдёт: 0 });
    app.db().newQuery(`
      SELECT COUNT(*) AS всего,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS отменено,
        SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS живых,
        SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS выручка,
        SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS картой,
        SUM(CASE WHEN payment_method = 'card' AND payment_status != 'paid' AND status != 'cancelled' THEN 1 ELSE 0 END) AS ждут,
        SUM(CASE WHEN status != 'cancelled' AND (items LIKE '%Ваза%' OR items LIKE '%ваза%') THEN 1 ELSE 0 END) AS ваз,
        SUM(CASE WHEN status != 'cancelled' AND drop_q != '' THEN 1 ELSE 0 END) AS дроп,
        SUM(CASE WHEN status != 'cancelled' AND items LIKE '%"kind":"basket"%' THEN 1 ELSE 0 END) AS корзин,
        SUM(CASE WHEN photo_status = 'waiting' THEN 1 ELSE 0 END) AS фотоЖдёт
      FROM orders WHERE date(created, '+3 hours') = {:d}`).bind({ d: day }).one(row);
    d.заказов = +row.всего; d.отменено = +row.отменено; d.живых = +row.живых;
    d.выручка = Math.round(+row.выручка); d.картой = +row.картой; d.ждут = +row.ждут;
    d.ваз = +row.ваз; d.дроп = +row.дроп; d.корзин = +row.корзин; d.фотоЖдёт = +row.фотоЖдёт;
  } catch (err) { console.log("сводка: заказы", err); }
  try {
    const row = new DynamicModel({ n: 0 });
    app.db().newQuery("SELECT COUNT(*) AS n FROM visits WHERE day = {:d}").bind({ d: day }).one(row);
    d.гостей = +row.n;
  } catch (_) {}
  try {
    const row = new DynamicModel({ n: 0 });
    app.db().newQuery("SELECT COUNT(DISTINCT vid) AS n FROM events WHERE day = {:d} AND kind = 'checkout'").bind({ d: day }).one(row);
    d.оформление = +row.n;
  } catch (_) {}
  d.чек = d.живых ? Math.round(d.выручка / d.живых) : 0;
  d.конверсия = d.гостей ? Math.round(d.живых * 1000 / d.гостей) / 10 : 0;
  return d;
}

const дельта = (a, b) => {
  if (!b) return a ? " (нового дня не с чем сравнить)" : "";
  const з = a - b;
  const п = Math.round(з * 100 / b);
  return з === 0 ? " (как вчера)" : ` (${з > 0 ? "+" : ""}${з}, ${п > 0 ? "+" : ""}${п}%)`;
};

function текст(app, день, вчера, неделя) {
  const dt = new Date(день.day + "T12:00:00Z");
  const шапка = `📊 ${ДНИ[dt.getUTCDay()]}, ${dt.getUTCDate()} ${МЕС[dt.getUTCMonth()]}`;
  const строки = [шапка, ""];
  строки.push(`Заказов ${день.живых}${дельта(день.живых, вчера.живых)}`);
  строки.push(`   тот же день недели назад — ${неделя.живых}`);
  строки.push(`Выручка ${shop.rub(день.выручка)}${дельта(день.выручка, вчера.выручка)}`);
  строки.push(`Средний чек ${shop.rub(день.чек)} · вчера ${shop.rub(вчера.чек)}`);
  строки.push("");
  строки.push(`Посетителей ${день.гостей} · дошли до оформления ${день.оформление}`);
  строки.push(`Конверсия в заказ ${день.конверсия}% · вчера ${вчера.конверсия}%`);
  строки.push("");
  строки.push(`Оплачено картой ${день.картой} из ${день.живых}${день.ждут ? ` · ждут оплату ${день.ждут}` : ""}`);
  if (день.отменено) строки.push(`Отменено ${день.отменено}`);
  const мелочь = [];
  if (день.ваз) мелочь.push(`ваз ${день.ваз}`);
  if (день.корзин) мелочь.push(`корзин ${день.корзин}`);
  if (день.дроп) мелочь.push(`дроп ${день.дроп}`);
  if (мелочь.length) строки.push("Докупили: " + мелочь.join(" · "));
  if (день.фотоЖдёт) { строки.push(""); строки.push(`⚠️ Фото без ответа покупателя: ${день.фотоЖдёт}`); }
  return строки.join("\n");
}

// Сводка за вчера — её и шлём утром. Сегодняшний день ещё не кончился, сравнивать
// его с полным днём нечестно.
function отправить(app, s) {
  const вчера = сутки(app, мскДень(-1));
  const позавчера = сутки(app, мскДень(-2));
  const неделю = сутки(app, мскДень(-8));
  const t = текст(app, вчера, позавчера, неделю);
  const кому = [];
  try {
    const token = s.get("tg_token");
    shop.adminIds(s).forEach((c) => { shop.tg(token, "sendMessage", { chat_id: c, text: t }); кому.push(String(c)); });
  } catch (err) { console.log("сводка: не отправил", err); }
  return { text: t, кому: кому.length };
}

module.exports = { отправить, сутки, текст, мскДень };
