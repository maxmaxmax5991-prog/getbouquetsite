/// <reference path="../pb_data/types.d.ts" />
// Отправка заказов в МойСклад: очередь раз в минуту, проверка токена и ручная отправка из админки.

cronAdd("ms-push", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const s = shop.settings($app);
  if (!s.get("ms_enabled") || !s.get("ms_token")) return;
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  // Берём только то, что вообще можно отправить. Доставку отправляем после оплаты,
  // и раньше неоплаченные занимали всю очередь: двадцать старых «ждём оплату»
  // выбирались первыми, а оплаченный самовывоз №3264 стоял за ними и не уходил
  // вовсе. Условие здесь то же, что внутри pushOrder.
  const годен = `ms_id = "" && status != "cancelled" && created > {:since} && (delivery_type = "pickup" || payment_status = "paid")`;
  // Склад ограничивает частоту запросов, а одна отправка — это несколько
  // обращений. Пять заказов за раз он ещё терпит, двадцать — уже нет; упёрлись
  // в ограничение — прекращаем до следующей минуты, иначе лупим в стену.
  //
  // ПОЧЕМУ СНАЧАЛА БЕЗ ОШИБКИ. Брали пять самых старых подряд — и заказ,
  // который не уйдёт никогда (нет номенклатуры на складе, название совпадает
  // сразу с несколькими), держал слот навсегда. 08.10 так встали пять штук
  // (Кейтлин 50 см, Аэробик 50 см, белая Кения), они заняли всю очередь, и
  // следующие четыре заказа — включая оплаченный №3816 — не дошли до склада
  // вообще: в логе их нет ни строкой, до них просто не доходил черёд.
  // Прокрутка `minutes % list.length` не спасала: она крутилась внутри тех же
  // пяти сломанных. Теперь слоты сперва отдаём тем, кто ещё ни разу не упал,
  // а остатком добираем проблемные — по кругу, чтобы и они не висели без попыток.
  const свежие = $app.findRecordsByFilter("orders", `${годен} && ms_error = ""`, "created", 5, 0, { since });
  let list = свежие;
  if (свежие.length < 5) {
    const сошибкой = $app.findRecordsByFilter("orders", `${годен} && ms_error != ""`, "created", 20, 0, { since });
    const off = сошибкой.length ? new Date().getMinutes() % сошибкой.length : 0;
    list = свежие.concat(сошибкой.slice(off).concat(сошибкой.slice(0, off)).slice(0, 5 - свежие.length));
  }
  let стоп = false;
  list.forEach((o) => {
    if (стоп) return;
    try {
      const r = msl.pushOrder($app, o);
      if (!r.ok && /Превышено ограничение/.test(String(r.error || ""))) стоп = true;
      // Неудачу видно только в карточке заказа, да и то если текст изменился.
      // В логе её не было вовсе — искать причину было нечем.
      if (!r.ok) console.log("ms-push:", o.get("number"), r.wait ? "ждём —" : "ошибка —", r.error);
      if (!r.ok && !r.wait && o.get("ms_error") !== r.error) { o.set("ms_error", r.error); $app.save(o); }
    } catch (err) { console.log("ms-push", err); require(`${__hooks}/lib/err.js`).note($app, "МойСклад", String(err), "очередь отправки"); }
  });

  // Добор входящих платежей. Платёж создаётся один раз, сразу после оплаты;
  // если тогда не получилось (связь, перезапуск), повторить было некому —
  // и заказ в МоёмСкладе оставался оплаченным, но без денег. Так вышло с №3021.
  // Двадцать доборов подряд выжигали минутный лимит склада, и отправка заказов
  // в следующую минуту падала с «превышено ограничение» — хотя сама по себе
  // укладывалась. Берём по пять и останавливаемся на первом же отказе по лимиту.
  const noPay = $app.findRecordsByFilter("orders",
    `payment_status = "paid" && ms_id != "" && ms_payment_id = "" && created > {:since}`,
    "created", 5, 0, { since });
  let стопPay = false;
  noPay.forEach((o) => {
    if (стопPay) return;
    try {
      const r = msl.addPayment($app, o);
      if (!r.ok && /Превышено ограничение/.test(String(r.error || ""))) стопPay = true;
      if (!r.ok && !r.wait) console.log("добор платежа", o.get("number"), r.error || "");
    } catch (err) { console.log("ms-pay", err); require(`${__hooks}/lib/err.js`).note($app, "МойСклад", String(err), "добор платежа"); }
  });
});

// Проверка привязок к МоемуСкладу: у каждого включённого сорта и каждой его
// ростовки должна существовать номенклатура на складе.
//
// ЗАЧЕМ. 07.10 вечером включили в продажу сорта нового привоза, а на складе
// этих ростовок не было: Аэробик 50 см, Кейтлин 50 см, Фёст Дейт 50 см. Узнали
// об этом не тогда, а когда покупатели уже оплатили — заказ не уходил в склад,
// флорист его не видел, и так встало девять заказов. Проверять надо ДО продажи,
// а не после оплаты: номенклатуру завести — минута, а сорванный заказ не
// вернуть. Хуже того, подбор может найти не ту номенклатуру и промолчать:
// «Леди Бомбастик 50 см» уезжала как «Бомбастик 50 см» — другой сорт, без
// единой ошибки где-либо.
//
// Кнопка «Проверить привязки сортов» в админке это уже умела (/api/shop/ms-check),
// но подсказка рядом обещала «та же проверка идёт сама каждое утро в 7:10» —
// а задания не было вовсе. Обещание выполняем: 04:10 UTC = 07:10 по Москве.
cronAdd("ms-binds", "10 4-8 * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const сегодня = new Date().toISOString().slice(0, 10);
  const ключ = "binds:done";
  const было = () => {
    try {
      const row = new DynamicModel({ value: "" });
      $app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: ключ }).one(row);
      return String(row.value || "");
    } catch (_) { return ""; }
  };
  const пометить = (v) => {
    try {
      const n = new Date().toISOString();
      $app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:t})
        ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:t}`).bind({ k: ключ, v: v, t: n }).execute();
    } catch (err) { console.log("ms-binds метка", err); }
  };
  if (было() === сегодня) return;                 // сегодня уже прошли полностью

  try {
    const s = shop.settings($app);
    if (!s.get("ms_enabled") || !s.get("ms_token")) return;
    const token = s.get("tg_token");
    const сказать = (t) => { if (token) shop.adminIds(s).forEach((c) => shop.tg(token, "sendMessage", { chat_id: c, text: t })); };

    const r = msl.проверитьПривязки($app, 50);
    if (!r.ok) return;

    if (r.беда && r.беда.length) {
      const строки = r.беда.slice(0, 12).map((b) => `• ${b.товар}, ${b.размер} — ${b.причина}`).join("\n");
      const хвост = r.беда.length > 12 ? `\n…и ещё ${r.беда.length - 12}.` : "";
      сказать(`⚠️ Сорта в продаже, которых склад не опознаёт. Заказ по ним оплатится, но в МойСклад не уйдёт.\n\n${строки}${хвост}`);
      require(`${__hooks}/lib/err.js`).note($app, "МойСклад", `Не привязано сортов: ${r.беда.length}`, "утренняя проверка привязок");
    }

    // ПОЧЕМУ ПЯТЬ ПОПЫТОК, А НЕ ОДНА. 10.10 проверка в 04:10 упёрлась в
    // ограничение склада — в этот час очередь как раз долбилась в него, —
    // вернула пустоту и ВЫШЛА МОЛЧА. В итоге «Аваланж» никто не проверил, и
    // четыре оплаченных заказа встали на нём же: 4029, 4068, 4085, 4107.
    // Теперь задание повторяется каждый час до 08:10, пока не пройдёт каталог
    // целиком, и отмечает день пройденным только после полного прохода.
    if (!r.ещё) { пометить(сегодня); return; }
    if (new Date().getUTCHours() >= 8) {
      сказать("⚠️ Проверку сортов сегодня не удалось довести до конца: склад весь день ограничивает частоту запросов. "
        + "Нажмите «Проверить привязки сортов» в админке, когда он успокоится — иначе новый сорт может встать уже после оплаты.");
      пометить(сегодня);
    }
  } catch (err) { console.log("ms-binds", err); }
});

// Проверка токена + списки организаций и складов для админки
// Служебное: какие этапы заказа есть в МоёмСкладе и какой из них мы выберем.
routerAdd("POST", "/api/shop/ms-states", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const s = shop.settings($app);
  const r = msl.ms(s, "GET", "/entity/customerorder/metadata");
  if (!r.ok) return e.json(400, { message: r.error });
  // заодно запоминаем номера этапов: чтобы первый же заказ не зависел от связи
  const paid = msl.stateId($app, s, true);
  const unpaid = msl.stateId($app, s, false);
  return e.json(200, {
    этапы: (r.data.states || []).map((x) => x.name),
    выберем_оплачен: msl.stateName(s, true),
    выберем_не_оплачен: msl.stateName(s, false),
    запомнили: !!(paid && unpaid),
  });
}, $apis.requireAuth("managers"));

// Служебное: какие доп. поля заказа есть в МоёмСкладе и что мы в них кладём.
// Значения-справочники ищутся по названию и при промахе молча пропускаются —
// так «Тип Оплаты» остался пустым у заказа №3143.
routerAdd("POST", "/api/shop/ms-attrs", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const s = shop.settings($app);
  const md = msl.ms(s, "GET", "/entity/customerorder/metadata/attributes");
  if (!md.ok) return e.json(400, { message: md.error });
  const хотим = {
    "Способ доставки": ["Самовывоз", "Доставка"],
    "Тип Оплаты": [s.get("ms_pay_card") || "CloudPayments", s.get("ms_pay_cash") || "Наличные/карта на ТТ"],
  };
  const out = (md.data.rows || []).map((a) => {
    const row = { поле: a.name, вид: a.type };
    if (a.type === "customentity" && a.customEntityMeta) {
      const id = String(a.customEntityMeta.href || "").split("/").pop();
      const list = msl.ms(s, "GET", `/entity/customentity/${id}?limit=100`);
      row.значения = list.ok ? (list.data.rows || []).map((r) => r.name) : ["(не смог прочитать)"];
      const want = хотим[a.name];
      if (want) row.ищем = want.map((w) => w + (row.значения.some((v) => String(v).toLowerCase().trim() === String(w).toLowerCase().trim()) ? " ✓" : " ✗ НЕ НАЙДЕНО"));
    }
    return row;
  });
  return e.json(200, { поля: out });
}, $apis.requireAuth("managers"));

routerAdd("POST", "/api/shop/ms-test", (e) => {
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const r = msl.refs(shop.settings($app));
  return r.ok ? e.json(200, r) : e.json(400, { message: r.error });
}, $apis.requireAuth("managers"));

// Кнопка «Отправить в МойСклад» у заказа
routerAdd("POST", "/api/shop/ms-push", (e) => {
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const msl = require(`${__hooks}/lib/ms.js`);
  const body = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(body.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  // Заказ уже там — не создаём второй, а дозаполняем доп. поля: время доставки,
  // способ доставки, тип оплаты. Ими в МоёмСкладе и рулятся статусы.
  if (o.get("ms_id")) {
    const u = msl.updateAttrs($app, o);
    if (!u.ok) return e.json(400, { message: u.error });
    return e.json(200, { ok: true, updated: true, filled: u.filled, missed: u.missed || [] });
  }
  const r = msl.pushOrder($app, o);
  if (!r.ok) { o.set("ms_error", r.error); $app.save(o); return e.json(400, { message: r.error }); }
  if (o.get("payment_status") === "paid") { msl.markPaid($app, o); msl.addPayment($app, o); }   // статус и входящий платёж
  return e.json(200, { ok: true, ms_id: r.id });
}, $apis.requireAuth("managers"));

// Проверка привязок к складу: какие сорта склад не опознает или опознаёт двояко.
// Запускается кнопкой и раз в сутки сторожем — чтобы узнавать до продажи, а не после.
routerAdd("POST", "/api/shop/ms-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const b = e.requestInfo().body || {};
  const r = require(`${__hooks}/lib/ms.js`).проверитьПривязки($app, +b.limit || 40);
  if (!r.ok) return e.json(400, { message: r.error });
  return e.json(200, r);
}, $apis.requireAuth("managers"));

// Раз в сутки, 07:10 по Москве: если какой-то сорт склад не опознаёт —
// говорим утром, пока никто его не купил.
cronAdd("ms-check", "10 4 * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  try {
    const s = shop.settings($app);
    if (!s.get("ms_enabled") || !s.get("ms_token")) return;
    const r = require(`${__hooks}/lib/ms.js`).проверитьПривязки($app, 40);
    if (!r.ok || !r.беда.length) return;
    const текст = "⚠️ Склад не опознаёт эти сорта — заказ с ними встанет:\n\n"
      + r.беда.slice(0, 12).map((x) => `• ${x.товар} ${x.размер}\n  ${x.причина}`).join("\n")
      + "\n\nПочинить: Товары → сорт → «Номенклатура в МоёмСкладе» у нужной длины.";
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat, text: текст }));
  } catch (err) { console.log("ms-check", err); }
});

// Заменить сорт в позиции заказа. Флорист собрал букет из другого сорта —
// деньги и количество те же, но в МоёмСкладе должна списаться правильная номенклатура.
routerAdd("POST", "/api/shop/order-swap", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  const b = e.requestInfo().body || {};

  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const items = shop.jget(o, "items") || [];
  const i = +b.index;
  if (!(i >= 0 && i < items.length)) return e.json(400, { message: "Нет такой позиции в заказе" });

  let p;
  try { p = $app.findRecordById("products", String(b.product || "")); } catch (_) { return e.json(404, { message: "Товар не найден" }); }

  const was = items[i].name;
  if (String(p.get("name")) === String(was)) return e.json(200, { ok: true, name: was });

  // Сумму и размер не трогаем: покупатель заплатил за свой букет, меняется только сорт
  items[i] = Object.assign({}, items[i], { id: p.id, name: p.get("name") });

  // Сначала убеждаемся, что новый сорт вообще есть в МоёмСкладе, и только потом сохраняем:
  // иначе в заказе останется сорт, который некуда списать.
  if (o.get("ms_id")) {
    const probe = msl.checkItem($app, items[i]);
    if (!probe.ok) return e.json(400, { message: probe.error || "Не нашёл этот сорт в МоёмСкладе" });
  }

  o.set("items", items);
  $app.save(o);

  const r = msl.syncPositions($app, o);
  if (!r.ok) return e.json(200, { ok: true, name: p.get("name"), warn: r.error || "В МойСклад не переписалось — проверьте вручную." });

  const s = shop.settings($app);
  shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
    text: `🔁 Заказ №${o.get("number")}: «${was}» заменили на «${p.get("name")}»` }));
  return e.json(200, { ok: true, name: p.get("name") });
}, $apis.requireAuth("managers"));
