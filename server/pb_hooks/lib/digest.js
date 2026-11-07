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
    const row = new DynamicModel({ total_n: 0, cancelled_n: 0, live_n: 0, revenue: 0, by_card: 0, waiting_n: 0,
      vases: 0, drop_n: 0, baskets_n: 0, photo_wait: 0 });
    app.db().newQuery(`
      SELECT COUNT(*) AS total_n,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_n,
        SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS live_n,
        SUM(CASE WHEN status != 'cancelled' THEN total ELSE 0 END) AS revenue,
        SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) AS by_card,
        SUM(CASE WHEN payment_method = 'card' AND payment_status != 'paid' AND status != 'cancelled' THEN 1 ELSE 0 END) AS waiting_n,
        SUM(CASE WHEN status != 'cancelled' AND (items LIKE '%Ваза%' OR items LIKE '%ваза%') THEN 1 ELSE 0 END) AS vases,
        SUM(CASE WHEN status != 'cancelled' AND drop_q != '' THEN 1 ELSE 0 END) AS drop_n,
        SUM(CASE WHEN status != 'cancelled' AND items LIKE '%"kind":"basket"%' THEN 1 ELSE 0 END) AS baskets_n,
        SUM(CASE WHEN photo_status = 'waiting' THEN 1 ELSE 0 END) AS photo_wait
      FROM orders WHERE date(created, '+3 hours') = {:d}`).bind({ d: day }).one(row);
    d.заказов = +row.total_n; d.отменено = +row.cancelled_n; d.живых = +row.live_n;
    d.выручка = Math.round(+row.revenue); d.картой = +row.by_card; d.ждут = +row.waiting_n;
    d.ваз = +row.vases; d.дроп = +row.drop_n; d.корзин = +row.baskets_n; d.фотоЖдёт = +row.photo_wait;
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
  const б = букеты(app, день.day);
  if (б.length) {
    строки.push("");
    строки.push("Букеты собрали:");
    б.forEach((p) => строки.push(`   ${p.имя} — ${p.сколько} на ${shop.rub(p.сумма)}`));
  }
  return строки.join("\n");
}

// Кто сколько букетов снял за день. Считаем по фото готового букета: другой
// отметки «собрал» через нас не проходит. Имя — то, что было в Телеграме в
// момент съёмки, поэтому отчёт за прошлый месяц читается и без справочника.
function букеты(app, day) {
  const out = [];
  // Сумма — цветы без доставки. Вазы и открытки здесь не вычитаем: в сводке
  // важен порядок величины, а точный разбор состава есть в админке.
  let имена = {};
  try { имена = shop.jget(shop.settings(app), "florist_names") || {}; } catch (_) {}
  try {
    const rows = arrayOf(new DynamicModel({ who: "", id: "", n: 0, sum: 0 }));
    app.db().newQuery(`SELECT coalesce(nullif(photo_by_name,''), 'без имени') AS who,
        coalesce(photo_by,'') AS id, COUNT(*) AS n,
        SUM(CASE WHEN coalesce(items_sum,0) > 0 THEN items_sum
                 ELSE max(0, coalesce(total,0) - coalesce(delivery_price,0)) END) AS sum
      FROM orders WHERE date(photo_at, '+3 hours') = {:d} AND coalesce(photo_at,'') != ''
      GROUP BY id, who ORDER BY sum DESC`).bind({ d: day }).all(rows);
    rows.forEach((r) => out.push({ имя: имена[r.id] || r.who, сколько: +r.n || 0, сумма: +r.sum || 0 }));
  } catch (err) { console.log("сводка: букеты", err); }
  return out;
}

// Темп дня: сколько оплат и денег пришло к этой минуте и как это выглядит
// против той же минуты вчера. С полным вчерашним днём сравнивать нельзя — в
// десять утра он всегда недосягаем, и цифра ничего не говорит.
//
// Считаем по `paid_at`, то есть по пришедшим деньгам, а не по заказам: отменённые
// потом заказы здесь остаются с обеих сторон, поэтому сравнение честное.
function темп(app, brand) {
  const мск = new Date(Date.now() + 3 * 3600e3);
  const минута = мск.toISOString().slice(11, 19);
  const витрина = brand ? " AND brand = {:b}" : "";
  const взять = (day) => {
    try {
      const row = new DynamicModel({ n: 0, s: 0 });
      const q = app.db().newQuery(`SELECT COUNT(*) AS n, coalesce(SUM(total), 0) AS s FROM orders
        WHERE payment_status = 'paid' AND coalesce(paid_at, '') != ''
          AND date(paid_at, '+3 hours') = {:d} AND time(paid_at, '+3 hours') <= {:t}${витрина}`);
      q.bind(brand ? { d: day, t: минута, b: String(brand) } : { d: day, t: минута }).one(row);
      return { оплат: +row.n || 0, сумма: Math.round(+row.s || 0) };
    } catch (err) { console.log("темп дня", err); return { оплат: 0, сумма: 0 }; }
  };
  return { час: минута.slice(0, 5), сегодня: взять(мскДень(0)),
    вчера: взять(мскДень(-1)), неделя: взять(мскДень(-7)) };
}

const слово = (n, одна, две, много) => {
  const a = n % 100, b = n % 10;
  if (a > 10 && a < 20) return много;
  if (b === 1) return одна;
  if (b >= 2 && b <= 4) return две;
  return много;
};

// Две строки под уведомлением об оплате. Пусто, если сегодня оплат ещё нет:
// первая оплата дня приходит вместе с этим же сообщением, но в базе она уже
// есть — значит пустой ответ бывает только при сбое запроса.
function темпТекст(app) {
  const t = темп(app);
  const с = t.сегодня, в = t.вчера;
  if (!с.оплат) return "";
  const строки = [`Сегодня к ${t.час} — ${с.оплат} ${слово(с.оплат, "оплата", "оплаты", "оплат")} на ${shop.rub(с.сумма)}`];
  if (!в.оплат) {
    строки.push("Вчера к этому часу оплат не было");
  } else {
    const з = с.сумма - в.сумма;
    const п = Math.round(з * 100 / в.сумма);
    const хвост = з === 0 ? "столько же" : `${з > 0 ? "+" : ""}${shop.rub(з)}, ${п > 0 ? "+" : ""}${п}%`;
    строки.push(`Вчера к этому часу — ${в.оплат} на ${shop.rub(в.сумма)} (${хвост})`);
  }
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

module.exports = { отправить, сутки, текст, мскДень, темп, темпТекст };
