/// <reference path="../pb_data/types.d.ts" />
// Дроп дня: витрина, очередь и раздача букетов.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное
// подключаем внутри обработчика.

// Что показывать на главной. Один запрос: состояние, часы сервера, лоты,
// моё место в очереди и моё приглашение со сроком.
routerAdd("GET", "/api/shop/drop", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const dr = require(`${__hooks}/lib/drop.js`);
  const d = dr.текущий($app);
  if (!d) return e.json(200, { есть: false, сейчас: dr.мск().полное });

  const имена = {};
  const фото = {};
  try {
    $app.findRecordsByFilter("products", "id != ''", "", 500, 0).forEach((p) => {
      имена[p.id] = p.get("name");
      const ф = p.get("photo") || [];
      if (ф.length) фото[p.id] = shop.fileUrl(p, ф[0], "560x0");
    });
  } catch (_) {}

  // кто спрашивает: по ключу покупателя узнаём его место в очереди
  let я = null;
  try {
    const t = e.requestInfo().headers.x_customer_token || e.request.header.get("X-Customer-Token");
    if (t) {
      const c = require(`${__hooks}/lib/account.js`).byToken($app, String(t));
      if (c) {
        let q = null;
        try { q = $app.findFirstRecordByFilter("drop_queue", "drop = {:d} && customer = {:c}", { d: d.id, c: c.id }); } catch (_) {}
        if (q) я = {
          место: +q.get("place") || 0, статус: q.get("status"),
          сорт: имена[q.get("product")] || "", до: q.get("expires_at") || "", заказ: q.get("order") || "",
        };
      }
    }
  } catch (_) {}

  return e.json(200, {
    есть: true,
    состояние: dr.состояние(d),
    сейчас: dr.мск().полное,
    старт: d.get("start_at"), доставка_с: d.get("ready_at"),
    цена: +d.get("price") || 0, штук: +d.get("cnt") || 0, длина: +d.get("len") || 0,
    // обычная цена того же количества в каталоге — чтобы было видно выгоду
    обычная: (() => {
      try {
        const т = shop.priceTables(shop.settings($app)).find((x) => x.id === "single");
        const строка = т && (т.prices || {})[String(+d.get("len") || 40)];
        return строка ? +строка[String(+d.get("cnt") || 101)] || 0 : 0;
      } catch (_) { return 0; }
    })(),
    подпись: d.get("note") || "",
    всего: dr.всего(d), свободно: dr.свободно(d),
    окно: dr.ОКНО,
    лоты: dr.лоты(d).map((l) => ({ id: l.product, name: имена[l.product] || "", img: фото[l.product] || "",
      qty: +l.qty || 0, left: Math.max(0, +l.left || 0) })),
    // Анонс: сортов ещё нет, но карточка не должна быть пустой — показываем
    // снимки прошлых дропов. Эльторо всегда первой, так просил владелец.
    анонс: dr.лоты(d).length ? [] : (() => {
      const сп = [];
      try {
        $app.findRecordsByFilter("products", "active = true", "name", 300, 0).forEach((p) => {
          const L = (shop.jget(p, "lengths") || []).map(Number);
          if (L.indexOf(+d.get("len") || 40) < 0) return;
          const ф = p.get("photo") || [];
          if (!ф.length) return;
          сп.push({ name: p.get("name"), img: shop.fileUrl(p, ф[0], "560x0") });
        });
      } catch (_) {}
      // Эльторо первой — так просил владелец. Берём её отдельно: сорт может
      // быть временно скрыт, а на снимке дропа он всё равно нужен.
      try {
        const э = $app.findFirstRecordByFilter("products", "name = 'Эльторо'");
        const ф = э.get("photo") || [];
        if (ф.length) {
          const кадр = { name: э.get("name"), img: shop.fileUrl(э, ф[0], "560x0") };
          const было = сп.findIndex((x) => x.name === кадр.name);
          if (было >= 0) сп.splice(было, 1);
          сп.unshift(кадр);
        }
      } catch (_) {}
      return сп.slice(0, 4);
    })(),
    очередь: dr.очередь($app, d, "waiting").length,
    я,
  });
});

// Встать в очередь. Нужен вход через бота: иначе некуда прислать «ваша очередь».
routerAdd("POST", "/api/shop/drop-queue", (e) => {
  const dr = require(`${__hooks}/lib/drop.js`);
  const acc = require(`${__hooks}/lib/account.js`);
  const d = dr.текущий($app);
  if (!d) return e.json(400, { message: "Сейчас дропа нет." });
  let c = null;
  try {
    const t = e.requestInfo().headers.x_customer_token || e.request.header.get("X-Customer-Token");
    if (t) c = acc.byToken($app, String(t));
  } catch (_) {}
  if (!c) return e.json(401, { message: "Войдите через бота — иначе мы не сможем позвать вас, когда подойдёт очередь." });
  if (!c.get("tg_chat") && !c.get("max_chat")) return e.json(400, { message: "Подпишитесь на бота: туда придёт сообщение, когда подойдёт очередь." });
  if (dr.ужеБрал($app, c.id, c.get("phone_ok") || c.get("phone")))
    return e.json(400, { message: "Один букет в руки за сутки. Приходите на завтрашний дроп." });

  // Имя и телефон берём при записи в очередь. Это не каприз: кому букета не
  // хватило — тому владелец звонит и предлагает замену, а без номера звонить
  // некуда. Подтверждённый из бота номер не перебиваем.
  const тело = e.requestInfo().body || {};
  const имя = String(тело.name || "").trim().slice(0, 120);
  const тел = String(тело.phone || "").trim().slice(0, 40);
  const цифры = тел.replace(/\D/g, "");
  const свой = String(c.get("phone_ok") || c.get("phone") || "").replace(/\D/g, "");
  if (цифры.length < 10 && свой.length < 10)
    return e.json(400, { message: "Оставьте телефон — позвоним, если букета не хватит." });
  if (имя && !c.get("name")) c.set("name", имя);
  if (цифры.length >= 10 && !c.get("phone")) c.set("phone", тел);
  try { $app.save(c); } catch (_) {}

  const q = dr.встать($app, d, c);
  if (имя || цифры.length >= 10) {
    try {
      $app.db().newQuery("UPDATE drop_queue SET name = {:n}, phone = {:p} WHERE id = {:id}")
        .bind({ n: имя || c.get("name") || "", p: цифры.length >= 10 ? тел : (c.get("phone_ok") || c.get("phone") || ""), id: q.id }).execute();
    } catch (_) {}
  }
  // Витрину запоминаем здесь: в задании раздачи её уже не узнать, а звать
  // покупателя lasflore.ru ботом venikoff — стыдно (и он просто не ответит).
  if (!q.get("brand")) {
    try {
      const br = require(`${__hooks}/lib/brand.js`).byHost($app, e);
      if (br) { $app.db().newQuery("UPDATE drop_queue SET brand = {:b} WHERE id = {:id}").bind({ b: br.id, id: q.id }).execute(); }
    } catch (_) {}
  }
  return e.json(200, { ok: true, место: +q.get("place") || 0, статус: q.get("status") });
});

// ---------- админка ----------
// Что показать во вкладке «Дроп»: сам дроп, сорта на выбор и очередь.
routerAdd("GET", "/api/shop/drops", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const dr = require(`${__hooks}/lib/drop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });

  const длина = 40;
  const сорта = [];
  try {
    $app.findRecordsByFilter("products", "active = true", "name", 300, 0).forEach((p) => {
      const L = (shop.jget(p, "lengths") || []).map(Number);
      if (L.indexOf(длина) < 0) return;
      const ст = shop.stockOf(p);
      сорта.push({ id: p.id, name: p.get("name"), stock: +ст[String(длина)] || 0 });
    });
  } catch (_) {}

  let список = [];
  try { список = $app.findRecordsByFilter("drops", "id != ''", "-date", 30, 0); } catch (_) {}
  const имена = {};
  try { $app.findRecordsByFilter("products", "id != ''", "", 500, 0).forEach((p) => { имена[p.id] = p.get("name"); }); } catch (_) {}

  const текущий = dr.текущий($app);
  let очередь = [];
  if (текущий) {
    очередь = dr.очередь($app, текущий).map((q) => ({
      место: +q.get("place") || 0, имя: q.get("name") || "", телефон: q.get("phone") || "",
      статус: q.get("status"), сорт: имена[q.get("product")] || "", до: q.get("expires_at") || "",
    }));
  }
  return e.json(200, {
    сейчас: dr.мск().полное,
    сорта,
    дропы: список.map((d) => ({
      id: d.id, date: d.get("date"), start_at: d.get("start_at"), ready_at: d.get("ready_at"),
      len: +d.get("len") || 40, cnt: +d.get("cnt") || 101, price: +d.get("price") || 0,
      note: d.get("note") || "", active: !!d.get("active"),
      lots: dr.лоты(d).map((l) => ({ product: l.product, name: имена[l.product] || "", qty: +l.qty || 0, left: +l.left || 0 })),
      состояние: dr.состояние(d),
    })),
    очередь,
  });
}, $apis.requireAuth("managers"));

// Завести или поправить дроп. Остаток букетов (left) пересчитываем только у
// тех сортов, где поменяли количество: продажа могла уже идти.
routerAdd("POST", "/api/shop/drop-save", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const dr = require(`${__hooks}/lib/drop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const день = String(b.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(день)) return e.json(400, { message: "Дата: ГГГГ-ММ-ДД" });
  const час = (v, имя) => {
    const t = String(v || "").trim();
    if (!/^\d{2}:\d{2}$/.test(t)) throw new BadRequestError(`${имя}: нужно ЧЧ:ММ`);
    return `${день} ${t}`;
  };
  let d = null;
  try { d = $app.findFirstRecordByFilter("drops", "date = {:d}", { d: день }); } catch (_) {}
  const новый = !d;
  if (!d) d = new Record($app.findCollectionByNameOrId("drops"));
  const старые = {};
  if (!новый) dr.лоты(d).forEach((l) => { старые[String(l.product)] = l; });

  d.set("date", день);
  d.set("start_at", час(b.start_at || "12:00", "Старт"));
  d.set("ready_at", час(b.ready_at || "15:00", "Доставляем с"));
  d.set("len", Math.max(1, +b.len || 40));
  d.set("cnt", Math.max(1, +b.cnt || 101));
  d.set("price", Math.max(0, Math.round(+b.price || 0)));
  d.set("note", String(b.note || "").slice(0, 300));
  d.set("active", !!b.active);
  d.set("lots", (Array.isArray(b.lots) ? b.lots : []).map((l) => {
    const pid = String(l.product || ""), qty = Math.max(0, Math.round(+l.qty || 0));
    const было = старые[pid];
    // количество не трогали — остаток оставляем как есть, продажа могла идти
    const left = было && +было.qty === qty ? Math.max(0, +было.left || 0) : qty;
    return { product: pid, qty, left };
  }).filter((l) => l.product && l.qty));
  $app.save(d);
  return e.json(200, { ok: true, id: d.id });
}, $apis.requireAuth("managers"));

// Участники дропов: с кем можно связаться. Собираем по всем дропам сразу —
// владельцу важны не отдельные записи, а человек: сколько раз приходил,
// сколько раз уходил ни с чем и по какому номеру ему звонить.
routerAdd("GET", "/api/shop/drop-people", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  let строки = [];
  try { строки = $app.findRecordsByFilter("drop_queue", "id != ''", "-created", 2000, 0); } catch (_) {}
  const дни = {};
  try { $app.findRecordsByFilter("drops", "id != ''", "-date", 60, 0).forEach((d) => { дни[d.id] = d.get("date"); }); } catch (_) {}

  const люди = {};
  строки.forEach((q) => {
    const ключ = q.get("customer") || q.get("chat") || q.id;
    const ч = люди[ключ] || (люди[ключ] = {
      customer: q.get("customer") || "", имя: "", телефон: "", чат: q.get("chat") || "",
      участий: 0, выиграл: 0, не_успел: 0, не_хватило: 0, последний: "", дни: [],
    });
    if (q.get("name") && !ч.имя) ч.имя = q.get("name");
    if (q.get("phone") && !ч.телефон) ч.телефон = q.get("phone");
    ч.участий++;
    const st = q.get("status");
    if (st === "paid") ч.выиграл++;
    else if (st === "missed") ч.не_успел++;
    else if (st === "out") ч.не_хватило++;
    const день = дни[q.get("drop")] || "";
    if (день) { ч.дни.push(день); if (!ч.последний || день > ч.последний) ч.последний = день; }
  });
  const список = Object.keys(люди).map((k) => люди[k]).sort((a, b) => (b.последний || "").localeCompare(a.последний || ""));
  return e.json(200, { всего: список.length, люди: список });
}, $apis.requireAuth("managers"));

// Заказ создан — отмечаем в очереди, что человек забрал свой букет.
// Делаем это после сохранения: до него у заказа нет номера, а привязать
// место в очереди к заказу надо, иначе потом не разобрать, кто что взял.
onRecordAfterCreateSuccess((e) => {
  try {
    const qид = e.record.get("drop_q");
    if (!qид) return;
    const dr = require(`${__hooks}/lib/drop.js`);
    let q = null;
    try { q = $app.findRecordById("drop_queue", String(qид)); } catch (_) { return; }
    dr.отметитьВзятие($app, q, e.record.id);
  } catch (err) { console.log("дроп: отметка заказа", err); }
  e.next();
}, "orders");

// Раздача букетов и просрочки. Раз в минуту: наступило 12:00 — зовём первых,
// кто-то не оплатил за 15 минут — его букет уходит следующему.
cronAdd("drop-run", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const dr = require(`${__hooks}/lib/drop.js`);
  const d = dr.текущий($app);
  if (!d) return;
  const старт = dr.вМс(d.get("start_at"));
  if (!старт || Date.now() < старт) return;

  const s = shop.settings($app);
  const mx = require(`${__hooks}/lib/max.js`);
  const имя = (pid) => { try { return $app.findRecordById("products", pid).get("name"); } catch (_) { return "букет"; } };
  const витрина = (q) => { try { return q.get("brand") ? $app.findRecordById("brands", q.get("brand")) : null; } catch (_) { return null; } };

  // Ссылка с одноразовым кодом: человек открывает её с телефона в любом
  // браузере и сразу оказывается вошедшим — иначе сайт его не узнает и
  // «ваша очередь подошла» покажет пустую страницу.
  const ссылка = (q, br) => {
    const сайт = shop.siteUrl($app, br ? br.id : "");
    if (!сайт) return "";
    try {
      const code = $security.randomString(24);
      const r = new Record($app.findCollectionByNameOrId("logins"));
      r.set("code", code); r.set("customer", q.get("customer")); r.set("brand", br ? br.id : "");
      $app.save(r);
      return `${сайт}/drop/?l=${code}`;
    } catch (_) { return `${сайт}/drop/`; }
  };
  // Пишем в тот мессенджер, которым человек пользуется
  const написать = (q, текст, кнопка, url) => {
    const br = витрина(q);
    if (q.get("chat")) {
      return shop.tg(shop.clientToken(s, br), "sendMessage", Object.assign({ chat_id: q.get("chat"), text: текст },
        url ? { reply_markup: { inline_keyboard: [[{ text: кнопка, url }]] } } : {}));
    }
    let мчат = "";
    try { мчат = $app.findRecordById("customers", q.get("customer")).get("max_chat") || ""; } catch (_) {}
    if (мчат) {
      const токен = (br && br.get("max_token")) || s.get("max_token");
      if (токен) return mx.send(токен, мчат, текст, url ? [[mx.btnLink(кнопка, url)]] : null);
    }
  };
  const деньДоставки = String(d.get("ready_at") || "").slice(0, 10) === dr.мск().день ? "сегодня" : "завтра";

  // 1. Просрочки: вернуть букет и отметить, что человек не успел
  dr.очередь($app, d, "invited").forEach((q) => {
    const до = Date.parse(String(q.get("expires_at") || "").replace(" ", "T"));
    if (!до || Date.now() < до) return;
    dr.вернутьЛот($app, d, q.get("product"));
    try {
      $app.db().newQuery("UPDATE drop_queue SET status = 'missed' WHERE id = {:id}").bind({ id: q.id }).execute();
    } catch (_) {}
    написать(q, `Время вышло — букет ушёл следующему в очереди.\n\nЗавтра в 12:00 новый дроп, встаньте в очередь заранее.`);
  });

  // 2. Раздача: столько приглашений, сколько свободных букетов
  const ждут = dr.очередь($app, d, "waiting");
  for (const q of ждут) {
    const лот = dr.щедрыйЛот(d);
    if (!лот) break;
    if (!dr.занятьЛот($app, d, лот.product)) break;
    const до = new Date(Date.now() + dr.ОКНО * 60000).toISOString().slice(0, 19).replace("T", " ");
    try {
      // Имена подстановок только латиницей: на кириллическом {:до} движок
      // запнулся («unrecognized token»), и ни одно приглашение не ушло.
      $app.db().newQuery(`UPDATE drop_queue SET status = 'invited', product = {:pid},
        invited_at = {:now}, expires_at = {:till} WHERE id = {:id}`)
        .bind({ pid: String(лот.product), now: new Date().toISOString().slice(0, 19).replace("T", " "), till: до, id: q.id }).execute();
    } catch (err) { console.log("дроп: приглашение", err); dr.вернутьЛот($app, d, лот.product); continue; }
    const br = витрина(q);
    написать(q,
      `🌹 Ваша очередь подошла!\n\n${имя(лот.product)}, ${+d.get("cnt") || 101} шт — ${shop.rub(+d.get("price") || 0)}.\n`
      + `🚚 Доставим ${деньДоставки} с ${String(d.get("ready_at") || "").slice(11)}.\n\n`
      + `Держим за вами ${dr.ОКНО} минут. Не успеете — букет уйдёт следующему в очереди.`,
      `Забрать за ${shop.rub(+d.get("price") || 0)}`, ссылка(q, br));
  }
});
