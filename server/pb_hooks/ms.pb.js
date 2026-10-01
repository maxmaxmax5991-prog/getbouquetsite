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
  const list = $app.findRecordsByFilter("orders",
    `ms_id = "" && status != "cancelled" && created > {:since} && (delivery_type = "pickup" || payment_status = "paid")`,
    "created", 5, 0, { since });
  // Склад ограничивает частоту запросов, а одна отправка — это несколько
  // обращений. Пять заказов за раз он ещё терпит, двадцать — уже нет; упёрлись
  // в ограничение — прекращаем до следующей минуты, иначе лупим в стену.
  // Если первый в очереди упирается в лимит, остальные за ним не доходят вовсе.
  // Поэтому каждую минуту начинаем с другого места — очередь прокручивается.
  const off = list.length ? new Date().getMinutes() % list.length : 0;
  const круг = list.slice(off).concat(list.slice(0, off));
  let стоп = false;
  круг.forEach((o) => {
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
