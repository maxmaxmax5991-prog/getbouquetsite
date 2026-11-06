/// <reference path="../pb_data/types.d.ts" />
// Кабинет менеджеров: отметка «я тут», линия, сотрудники, ответственный за заказ.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня этого файла —
// всё общее лежит в lib/staff.js и подключается внутри обработчика.

// Отметка «я за экраном». Админка дёргает раз в полминуты; в ответ — кто сейчас
// в сети, чтобы точки у ников обновлялись без отдельного запроса.
routerAdd("POST", "/api/shop/beat", (e) => {
  const st = require(`${__hooks}/lib/staff.js`);
  const я = st.нынешний($app, e);
  if (!я) return e.json(403, { message: "Войдите заново." });
  st.отметиться($app, я.id);
  return e.json(200, { ok: true, линия: я.get("line") || "", люди: st.живые($app) });
}, $apis.requireAuth("managers"));

// «На линии» / «Занят». Занятому автоназначение новых заказов не даёт.
routerAdd("POST", "/api/shop/line", (e) => {
  const st = require(`${__hooks}/lib/staff.js`);
  const я = st.нынешний($app, e);
  if (!я) return e.json(403, { message: "Войдите заново." });
  const v = String((e.requestInfo().body || {}).line || "");
  if (["on", "busy", ""].indexOf(v) < 0) return e.json(400, { message: "Такого состояния нет." });
  try {
    $app.db().newQuery("UPDATE managers SET line = {:v}, seen_at = {:t} WHERE id = {:id}")
      .bind({ v, t: new Date().toISOString(), id: я.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  return e.json(200, { ok: true, линия: v });
}, $apis.requireAuth("managers"));

// Взять заказ на себя, передать другому или вернуть в общий котёл.
routerAdd("POST", "/api/shop/order-take", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const я = st.нынешний($app, e);
  const b = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }

  const былId = o.get("manager") || "";
  let кому = "", имя = "";
  if (b.to === "" || b.to === null) { кому = ""; имя = "никто"; }
  else {
    const id = String(b.to || (я && я.id) || "");
    let r; try { r = $app.findRecordById("managers", id); } catch (_) { return e.json(404, { message: "Сотрудник не найден" }); }
    кому = r.id; имя = r.get("name") || r.get("nick") || "";
  }
  if (кому === былId) return e.json(200, { ok: true, manager: кому });
  try {
    $app.db().newQuery(`UPDATE orders SET manager = {:m}, manager_at = {:t}, manager_how = {:h} WHERE id = {:id}`)
      .bind({ m: кому, t: кому ? new Date().toISOString() : "", h: кому ? "hand" : "", id: o.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }

  let былИмя = "никто";
  if (былId) { try { const r = $app.findRecordById("managers", былId); былИмя = r.get("name") || r.get("nick"); } catch (_) { былИмя = "кто-то"; } }
  st.запись($app, o, я, "ответственный", `${былИмя} → ${имя}`);
  return e.json(200, { ok: true, manager: кому });
}, $apis.requireAuth("managers"));

// Лента правок заказа.
routerAdd("GET", "/api/shop/order-log", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const id = String(e.request.url.query().get("order") || "");
  let r = [];
  try { r = $app.findRecordsByFilter("order_log", "order = {:o}", "-at", 200, 0, { o: id }); } catch (_) {}
  return e.json(200, { строки: r.map((x) => ({
    at: x.get("at"), nick: x.get("nick"), action: x.get("action"), text: x.get("text"),
  })) });
}, $apis.requireAuth("managers"));

// Новый заказ — сразу назначаем ответственного и открываем ленту.
onRecordAfterCreateSuccess((e) => {
  try {
    const st = require(`${__hooks}/lib/staff.js`);
    st.запись($app, e.record, null, "создан", `Заказ №${e.record.get("number")} на ${e.record.get("total")} ₽`);
    // Назначаем при создании, а не после оплаты: кто-то должен дожимать оплату.
    st.назначить($app, e.record);
  } catch (err) { console.log("staff: новый заказ", err); }
  // БЕЗ e.next() ОБРЫВАЕТСЯ ВСЯ ЦЕПОЧКА. Хуки на создание заказа идут друг за
  // другом, и порядок их регистрации зависит от того, в каком порядке сервер
  // прочитал файлы pb_hooks. Когда этот хук оказывался первым, следом не
  // работало ничего: дроп не отмечал, что букет забрали (4 ноября так «вернулись
  // в продажу» пять проданных букетов), а флорист не получал карточку заказа.
  e.next();
}, "orders");

// Сводка за сегодня: общие числа и строка на каждого менеджера.
//
// «Просрочек 3 мин» считаем по переписке: сообщение покупателя, на которое
// ответили позже трёх минут (или ещё не ответили). Вешаем на того, кто в итоге
// ответил; неотвеченные — на ответственного за диалог, а если его нет — в
// общий счётчик. Считать можно только с того дня, как начали записывать автора
// ответа: до этого в базе пусто, и прошлые дни покажут нули.
routerAdd("POST", "/api/shop/team-day", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const день = String(b.day || shop.moscowToday());
  // сутки по Москве: в базе время по Гринвичу, поэтому берём с 21:00 предыдущего
  const с = new Date(new Date(`${день}T00:00:00+03:00`)).toISOString().replace("T", " ").slice(0, 19);
  const по = new Date(new Date(`${день}T23:59:59+03:00`)).toISOString().replace("T", " ").slice(0, 19);

  let заказы = [];
  try { заказы = $app.findRecordsByFilter("orders", "created >= {:a} && created <= {:b}", "created", 1000, 0, { a: с, b: по }); } catch (_) {}
  const поЛюдям = {};
  const строка = (id) => (поЛюдям[id] = поЛюдям[id] || { взял: 0, закрыл: 0, отменил: 0, сумма: 0, просрочек: 0 });

  let сумма = 0, оплачено = 0, отменено = 0, ничьих = 0;
  заказы.forEach((o) => {
    const отм = o.get("status") === "cancelled";
    if (!отм) сумма += +o.get("total") || 0;
    if (o.get("payment_status") === "paid") оплачено++;
    if (отм) отменено++;
    const m = o.get("manager") || "";
    if (!m) { ничьих++; return; }
    const r = строка(m);
    r.взял++;
    if (o.get("status") === "done") r.закрыл++;
    if (отм) r.отменил++; else r.сумма += +o.get("total") || 0;
  });

  // просрочки по переписке
  let сообщения = [];
  try { сообщения = $app.findRecordsByFilter("chat_messages", "created >= {:a} && created <= {:b}", "created", 3000, 0, { a: с, b: по }); } catch (_) {}
  const поДиалогам = {};
  сообщения.forEach((m) => { (поДиалогам[m.get("chat")] = поДиалогам[m.get("chat")] || []).push(m); });
  let просрочекВсего = 0;
  Object.keys(поДиалогам).forEach((cid) => {
    const список = поДиалогам[cid];
    let ждёт = null;
    список.forEach((m) => {
      const t = Date.parse(String(m.get("created")).replace(" ", "T"));
      if (m.get("side") === "client") { if (!ждёт) ждёт = t; return; }
      if (ждёт) {
        if (t - ждёт > 3 * 60000) { просрочекВсего++; const a = m.get("author") || ""; if (a) строка(a).просрочек++; }
        ждёт = null;
      }
    });
    // так и не ответили до конца суток
    if (ждёт && Date.now() - ждёт > 3 * 60000) просрочекВсего++;
  });

  return e.json(200, {
    заказов: заказы.length, сумма, оплачено, отменено, ничьих,
    чек: заказы.length ? Math.round(сумма / Math.max(1, заказы.length - отменено)) : 0,
    просрочекВсего, поЛюдям,
  });
}, $apis.requireAuth("managers"));

// Сколько букетов снял каждый за день. Фото готового букета — единственная
// отметка «букет собран», которая проходит через нас, поэтому считаем по ней.
//
// День берём по photo_at, а не по created заказа: заказ могли оформить вчера
// вечером, а собрать сегодня утром — и в отчёт он должен попасть сегодня.
routerAdd("GET", "/api/shop/bouquets", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const день = String(e.request.url.query().get("day") || shop.moscowToday());
  // сутки по Москве: в базе время по Гринвичу
  const с = new Date(`${день}T00:00:00+03:00`).toISOString();
  const по = new Date(`${день}T23:59:59+03:00`).toISOString();

  let список = [];
  try {
    список = $app.findRecordsByFilter("orders",
      `photo_at >= {:a} && photo_at <= {:b}`, "photo_at", 1000, 0, { a: с, b: по });
  } catch (err) { return e.json(500, { message: String(err) }); }

  // Имя из Телеграма бывает в одну букву — владелец может переименовать человека,
  // и это имя сильнее телеграмного.
  let своиИмена = {};
  try { своиИмена = shop.jget(shop.settings($app), "florist_names") || {}; } catch (_) {}

  // Что в заказе довесок, а не работа флориста: вазы, открытки, игрушки. Их
  // кладут в пакет, а не собирают. Одним запросом на весь день.
  const довесок = {};
  try {
    const rows = arrayOf(new DynamicModel({ id: "" }));
    $app.db().newQuery(`SELECT p.id AS id FROM products p
      JOIN categories c ON c.id = p.category WHERE c.addon = 1`).all(rows);
    rows.forEach((r) => { довесок[r.id] = 1; });
  } catch (err) { console.log("букеты: довески", err); }

  // Сколько стоит сам букет. Доставку не считаем — это не работа флориста, и
  // владелец спросил именно про букет. items_sum у заказа уже без доставки,
  // но внутри него могут быть вазы, поэтому разбираем состав.
  const цена = (o) => {
    let всё = +o.get("items_sum") || 0;
    if (!всё) всё = Math.max(0, (+o.get("total") || 0) - (+o.get("delivery_price") || 0));
    let лишнее = 0;
    try {
      (shop.jget(o, "items") || []).forEach((it) => {
        if (довесок[String(it.id || "")]) лишнее += +it.sum || 0;
      });
    } catch (_) {}
    return { букет: Math.max(0, всё - лишнее), довески: лишнее };
  };

  const люди = {};
  список.forEach((o) => {
    const id = String(o.get("photo_by") || "");
    const имя = своиИмена[id] || String(o.get("photo_by_name") || "") || (id ? `id ${id}` : "без подписи");
    const ключ = id || "нет";
    const p = (люди[ключ] = люди[ключ] || { id, имя, букетов: 0, сумма: 0, довески: 0, заказы: [], первое: "", последнее: "" });
    p.имя = имя;
    p.букетов++;
    const c = цена(o);
    p.сумма += c.букет;
    p.довески += c.довески;
    if (p.заказы.length < 60) p.заказы.push({ n: o.get("number"), с: c.букет });
    const t = String(o.get("photo_at") || "");
    if (!p.первое || t < p.первое) p.первое = t;
    if (!p.последнее || t > p.последнее) p.последнее = t;
  });

  // Фото, снятые до того, как мы начали записывать автора. Без этой строки
  // «0 букетов» читалось бы как «никто не работал», а это дырка в данных, и
  // только за переходный день. Точного времени съёмки у них нет, поэтому
  // ориентируемся на последнюю правку заказа.
  let безАвтора = 0;
  try {
    const r = new DynamicModel({ n: 0 });
    $app.db().newQuery(`SELECT count(*) AS n FROM orders
      WHERE photo_file_id != '' AND coalesce(photo_at,'') = '' AND date(updated, '+3 hours') = {:d}`)
      .bind({ d: день }).one(r);
    безАвтора = +r.n || 0;
  } catch (_) {}

  const люди2 = Object.keys(люди).map((k) => люди[k]).sort((a, b) => b.сумма - a.сумма);
  люди2.forEach((p) => { p.чек = p.букетов ? Math.round(p.сумма / p.букетов) : 0; });
  return e.json(200, { день, безАвтора, всего: список.length,
    сумма: люди2.reduce((n, p) => n + p.сумма, 0), люди: люди2 });
}, $apis.requireAuth("managers"));

// Переименовать флориста: в Телеграме он «ми», а в отчёте должен быть человеком.
routerAdd("POST", "/api/shop/florist-name", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "sales", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const id = String(b.id || "").replace(/[^\d-]/g, "");
  if (!id) return e.json(400, { message: "Не указан человек." });
  const s = shop.settings($app);
  let карта = {};
  try { карта = shop.jget(s, "florist_names") || {}; } catch (_) {}
  const имя = String(b.name || "").trim().slice(0, 80);
  if (имя) карта[id] = имя; else delete карта[id];
  // запросом, мимо хуков: сохранение настроек целиком будит setup бота
  try {
    $app.db().newQuery("UPDATE settings SET florist_names = {:v} WHERE id = {:id}")
      .bind({ v: JSON.stringify(карта), id: s.id }).execute();
  } catch (err) { return e.json(500, { message: String(err) }); }
  return e.json(200, { ok: true, имя });
}, $apis.requireAuth("managers"));
