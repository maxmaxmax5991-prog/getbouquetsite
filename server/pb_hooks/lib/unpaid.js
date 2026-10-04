// Брошенная оплата: вернуть цветы, напомнить по-человечески, погасить заказ.
//
// Остаток списывается в момент создания заказа (prepareOrder → take), а назад
// не возвращался никогда — ни при отмене, ни если так и не оплатили. За неделю
// 05.10 так заперлось 3322 стебля: цветы лежат в холодильнике, а сайт говорит
// «осталось 0» и отбивает следующего покупателя. Круг замыкался сам на себя.
//
// Данные, на которых построены сроки (неделя до 05.10.2026):
//   250 из 263 оплат проходят за 10 минут;
//   позже того же дня не платит НИКТО — за 14 дней ни одной оплаты через сутки;
//   13 из 48 «брошенных» на деле переоформили заказ и оплатили — им писать нельзя.
const shop = require(`${__hooks}/lib/shop.js`);

// ---------- возврат остатков ----------

// Вернуть на склад то, что заказ занял. Идемпотентно: отметка stock_back
// пишется запросом, мимо хуков, чтобы соседнее сохранение её не затёрло.
function вернутьОстатки(app, o) {
  if (o.get("stock_back")) return 0;
  const items = shop.jget(o, "items");
  if (!Array.isArray(items)) return 0;
  let стеблей = 0;
  items.forEach((it) => {
    const m = String(it.label || "").match(/^(\d+)-(\d+)$/);
    if (!m) return;
    const надо = +m[2] * (+it.qty || 1);
    let p;
    try { p = app.findRecordById("products", String(it.id)); } catch (_) { return; }
    const st = shop.stockOf(p);
    // учёта по этой длине нет — возвращать некуда, и заводить его задним числом нельзя
    if (st[m[1]] === undefined || st[m[1]] === null) return;
    st[m[1]] = (+st[m[1]] || 0) + надо;
    try {
      app.db().newQuery("UPDATE products SET stock = {:v} WHERE id = {:id}")
        .bind({ v: JSON.stringify(st), id: p.id }).execute();
      стеблей += надо;
    } catch (err) { console.log("возврат остатка", p.id, err); }
  });
  try { app.db().newQuery("UPDATE orders SET stock_back = true WHERE id = {:id}").bind({ id: o.id }).execute(); } catch (_) {}
  return стеблей;
}

// ---------- что сказал банк ----------
// Главный путь оплаты уводит покупателя на страницу CloudPayments, поэтому
// отказ карты происходит вне сайта и в нашу базу не попадает. Спрашиваем сам
// банк: «закрыл окно» и «карту отклонили» — разные люди, и письма им нужны
// разные. Список за день берём ОДИН раз на весь обход, а не на каждый заказ.
function отказыЗаСегодня(app, s) {
  const карта = {};
  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true", "sort", 20, 0); } catch (_) {}
  const день = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  (brands.length ? brands : [null]).forEach((b) => {
    try {
      const pay = require(`${__hooks}/lib/pay.js`);
      const r = pay.cp(s, "/payments/list", { Date: день, TimeZone: "MSK" }, b);
      if (!r.ok || !r.data || !r.data.Model) return;
      r.data.Model.forEach((x) => {
        if (x.Status !== "Declined" || x.TestMode) return;
        const inv = String(x.InvoiceId || "");
        if (inv) карта[inv] = String(x.Reason || x.CardHolderMessage || "отказ банка");
      });
    } catch (err) { console.log("unpaid: отказы", err); }
  });
  return карта;
}

// ---------- тексты ----------
// Тон дружественный — решение владельца 05.10. Не «погасите задолженность»,
// а «придержали букет». Человек ничего нам не должен, он просто не дошёл.

function первое(o, доКогда, отказ) {
  if (отказ) {
    return `Привет! Банк не пропустил оплату букета на ${shop.rub(o.get("total"))} — такое бывает с лимитами и онлайн-платежами.\n\n`
      + `Цветы мы за вами придержали${доКогда ? ` до ${доКогда}` : ""}. Попробуйте другую карту по кнопке ниже — или просто напишите сюда, и мы оформим оплату другим способом.`;
  }
  return `Привет! Вы собрали букет на ${shop.rub(o.get("total"))}, а оплата так и не прошла — бывает, окно закрылось само.\n\n`
    + `Мы придержали цветы за вами${доКогда ? ` до ${доКогда}` : ""}. Оплатить можно по кнопке ниже, это пара минут.`;
}

function второе(o, доКогда, отказ) {
  return `Букет всё ещё ждёт вас${доКогда ? ` — держим до ${доКогда}` : ""}.\n\n`
    + (отказ
      ? `Если карта так и не проходит — напишите сюда, подберём другой способ оплаты и всё оформим.`
      : `Если что-то не получается с оплатой — просто напишите сюда, поможем и оформим вручную.`);
}

function погашен(o) {
  return `Заказ №${o.get("number")} мы сняли — цветы вернули в продажу, чтобы они не простаивали.\n\n`
    + `Если букет всё ещё нужен, оформите заново на сайте, это быстро. А если что-то не получилось с оплатой — напишите сюда, поможем.`;
}

// ---------- кому писать нельзя ----------

// Человек мог переоформить заказ сам и оплатить: 13 из 48 за неделю. Написать
// такому «вы не оплатили» — выглядеть глупо. Ищем по последним десяти цифрам.
function ужеОплатилДругим(app, o) {
  const хвост = String(o.get("phone") || "").replace(/\D/g, "").slice(-10);
  if (хвост.length !== 10) return false;
  try {
    const n = app.findRecordsByFilter("orders",
      `payment_status = "paid" && id != {:id} && created >= {:t}`, "-created", 20, 0,
      { id: o.id, t: String(o.get("created")).slice(0, 19) });
    return n.some((x) => String(x.get("phone") || "").replace(/\D/g, "").slice(-10) === хвост);
  } catch (_) { return false; }
}

// ---------- обход ----------

// Срок жизни неоплаченного заказа в минутах
function срок(s) { return Math.max(10, +s.get("pay_ttl_min") || 60); }

// Время, до которого держим букет — покупателю говорим по-московски
function доКогда(o, s) {
  try {
    const t = new Date(new Date(String(o.get("created")).replace(" ", "T") + "Z").getTime() + срок(s) * 60000);
    const м = new Date(t.getTime() + 3 * 3600 * 1000);
    return `${String(м.getUTCHours()).padStart(2, "0")}:${String(м.getUTCMinutes()).padStart(2, "0")}`;
  } catch (_) { return ""; }
}

function минутСоздания(o) {
  try { return (Date.now() - new Date(String(o.get("created")).replace(" ", "T") + "Z").getTime()) / 60000; }
  catch (_) { return 0; }
}

// Одно сообщение покупателю в тот бот, которым он пользуется.
// Адрес витрины — её домен, иначе общий site_url: ссылка на оплату должна вести
// на тот сайт, где оформляли, иначе покупатель «Гет Букета» попадёт к venikoff.
function написать(app, o, текст, сКнопкой) {
  const s = shop.settings(app);
  const brand = shop.brandOfOrder(app, o);
  const site = String((brand && brand.get("domain") ? "https://" + brand.get("domain") : "") || s.get("site_url") || "").replace(/\/$/, "");
  const код = o.get("tg_code");
  const ссылка = (site && код) ? `${site}/#/order/${код}` : "";
  if (o.get("tg_chat")) {
    const token = shop.clientToken(s, brand);
    if (!token) return false;
    const kb = (сКнопкой && ссылка) ? { inline_keyboard: [[{ text: "💳 Оплатить букет", url: ссылка }]] } : undefined;
    const r = shop.tg(token, "sendMessage", { chat_id: o.get("tg_chat"), text: текст, reply_markup: kb });
    return !!(r && r.ok);
  }
  if (o.get("max_chat")) {
    // в MAX кнопок-ссылок под сообщением нет — адрес уходит строкой
    try {
      const r = require(`${__hooks}/lib/max.js`).send(s.get("max_token"), o.get("max_chat"), текст + (ссылка ? `\n\n${ссылка}` : ""));
      return !!(r && r.ok);
    } catch (err) { console.log("unpaid max", err); return false; }
  }
  return false;
}

// Главный обход: раз в пять минут. Напоминаем и гасим.
//
// Берём только заказы, оформленные ПОСЛЕ включения этой машинки (`unpaid_from`).
// Иначе в первую же минуту пятидесяти людям, заказывавшим на прошлой неделе,
// прилетело бы «мы придержали ваш букет» — букета давно нет, и повод прошёл.
// Старый завал разбирается отдельной кнопкой, молча: `разобратьЗавал`.
function обход(app) {
  const s = shop.settings(app);
  const ttl = срок(s);
  const сКакого = String(s.get("unpaid_from") || "");
  if (!сКакого) return null;                      // машинка ещё не включена
  const граница = сКакого.replace("T", " ").slice(0, 19);
  let список = [];
  try {
    список = app.findRecordsByFilter("orders",
      `payment_method = "card" && payment_status != "paid" && status != "cancelled" && created > {:t}`,
      "created", 100, 0, { t: граница });
  } catch (err) { console.log("unpaid: не прочитал заказы", err); return null; }

  const итог = { напомнили: 0, погасили: 0, стеблей: 0, пропустили: 0, отказов: 0 };
  // спрашиваем банк один раз на весь обход, и только если есть кому писать
  const естьКому = список.some((o) => минутСоздания(o) >= 20);
  const отказы = естьКому ? отказыЗаСегодня(app, s) : {};

  список.forEach((o) => {
    const прошло = минутСоздания(o);
    if (прошло < 20) return;                       // 250 из 263 платят за 10 минут, раньше дёргать незачем
    if (ужеОплатилДругим(app, o)) { итог.пропустили++; return; }
    const было = +o.get("reminds") || 0;
    const отказ = отказы[shop.invoiceOf(o)] || "";
    if (отказ && !o.get("pay_error")) {
      итог.отказов++;
      try {
        app.db().newQuery("UPDATE orders SET pay_error = {:e}, pay_error_at = {:t} WHERE id = {:id}")
          .bind({ e: отказ.slice(0, 300), t: new Date().toISOString(), id: o.id }).execute();
      } catch (_) {}
    }

    if (прошло >= ttl) {
      // Заказ уже уехал в МойСклад — значит, его могли начать собирать (так
      // бывает с самовывозом: он уходит на склад сразу, не дожидаясь оплаты).
      // Гасить такой молча нельзя: скажем владельцу, пусть решает человек.
      if (o.get("ms_id")) {
        if (было < 9) {
          try {
            app.db().newQuery("UPDATE orders SET reminds = 9 WHERE id = {:id}").bind({ id: o.id }).execute();
          } catch (_) {}
          const s2 = shop.settings(app);
          shop.adminIds(s2).forEach((chat) => shop.tg(s2.get("tg_token"), "sendMessage", { chat_id: chat,
            text: `⚠️ Заказ №${o.get("number")} на ${shop.rub(o.get("total"))} не оплачен час, но он уже в МоёмСкладе — сам гасить не стал.\n${o.get("name")}, ${o.get("phone")}` }));
          итог.пропустили++;
        }
        return;
      }
      const стеблей = вернутьОстатки(app, o);
      итог.стеблей += стеблей;
      try {
        app.db().newQuery("UPDATE orders SET status = 'cancelled' WHERE id = {:id}").bind({ id: o.id }).execute();
      } catch (err) { console.log("unpaid: не погасил", o.id, err); return; }
      написать(app, o, погашен(o), false);
      итог.погасили++;
      return;
    }

    // Два напоминания внутри срока: на трети и на двух третях пути.
    const ступень = прошло >= ttl * 0.66 ? 2 : прошло >= ttl * 0.33 ? 1 : 0;
    if (!ступень || было >= ступень) return;
    const был = отказ || o.get("pay_error") || "";
    const текст = ступень === 1 ? первое(o, доКогда(o, s), был) : второе(o, доКогда(o, s), был);
    if (!написать(app, o, текст, true)) return;
    try {
      app.db().newQuery("UPDATE orders SET reminds = {:n}, remind_at = {:t} WHERE id = {:id}")
        .bind({ n: ступень, t: new Date().toISOString(), id: o.id }).execute();
    } catch (_) {}
    итог.напомнили++;
  });
  return итог;
}

// Разбор старого завала — один раз, кнопкой из админки и МОЛЧА.
//
// На момент включения висело 65 неоплаченных и отменённых заказов, запершие
// 3322 стебля. Цветы вернуть надо, а писать этим людям нельзя: повод прошёл,
// у половины заказ был «на сегодня» неделю назад. Поэтому гасим запросом,
// мимо хуков: иначе сработало бы обычное уведомление «заказ отменён».
function разобратьЗавал(app, доМинут, применить) {
  const край = new Date(Date.now() - (доМинут || 180) * 60000).toISOString().replace("T", " ").slice(0, 19);
  let список = [];
  try {
    список = app.findRecordsByFilter("orders",
      `payment_method = "card" && payment_status != "paid" && status != "cancelled" && created < {:t}`,
      "created", 500, 0, { t: край });
  } catch (err) { return { ok: false, error: String(err) }; }
  let стеблей = 0, погашено = 0;
  список.forEach((o) => {
    if (o.get("ms_id")) return;                 // уже на складе — руками, не скопом
    if (!применить) { стеблей += стеблейВЗаказе(app, o); return; }
    стеблей += вернутьОстатки(app, o);
    try {
      app.db().newQuery("UPDATE orders SET status = 'cancelled' WHERE id = {:id}").bind({ id: o.id }).execute();
      погашено++;
    } catch (err) { console.log("завал", o.id, err); }
  });
  const годных = список.filter((o) => !o.get("ms_id")).length;
  return { ok: true, заказов: годных, погашено, стеблей, наСкладе: список.length - годных };
}

// Сколько стеблей держит заказ — для предварительного подсчёта, без правок
function стеблейВЗаказе(app, o) {
  if (o.get("stock_back")) return 0;
  const items = shop.jget(o, "items");
  if (!Array.isArray(items)) return 0;
  let n = 0;
  items.forEach((it) => {
    const m = String(it.label || "").match(/^(\d+)-(\d+)$/);
    if (m) n += +m[2] * (+it.qty || 1);
  });
  return n;
}

module.exports = { обход, вернутьОстатки, срок, разобратьЗавал };
