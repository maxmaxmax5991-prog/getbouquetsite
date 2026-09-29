/// <reference path="../pb_data/types.d.ts" />

// Ссылка на оплату: покупателя уводим на страницу CloudPayments, а они после оплаты
// возвращают его на страницу заказа. Виджет для этого не годится — его кнопка
// «Вернуться в магазин» ничего не делает, а на телефоне он ещё и теряет управление.
routerAdd("POST", "/api/shop/pay-link", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const s = shop.settings($app);
  const body = e.requestInfo().body || {};

  let o;
  try { o = $app.findRecordById("orders", String(body.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  if (o.get("payment_status") === "paid") return e.json(200, { paid: true });
  if (o.get("payment_method") !== "card") return e.json(400, { message: "Этот заказ оплачивается при получении." });

  // Витрина заказа решает две вещи: на чей терминал уйдут деньги и куда вернуть
  // покупателя. Раньше ссылка всегда открывалась ключом venikoff — у «Гет Букета»
  // оплата уходила бы на чужой счёт.
  const brand = shop.brandOfOrder($app, o);
  const site = String((brand && brand.get("domain") ? "https://" + brand.get("domain") : "") || s.get("site_url") || "").replace(/\/$/, "");
  const back = `${site}/#/order/${o.get("tg_code")}`;
  const r = pay.cp(s, "/orders/create", {
    Amount: o.get("total"),
    Currency: "RUB",
    Description: `Заказ №${o.get("number")} — ${(brand && brand.get("name")) || "venikoff.net"}`,
    InvoiceId: shop.invoiceOf(o),
    AccountId: String(o.get("phone") || ""),
    RequireConfirmation: false,
    SuccessRedirectUrl: back,
    FailRedirectUrl: back,
  }, brand);
  if (!r.ok || !r.data || !r.data.Success || !r.data.Model || !r.data.Model.Url) {
    console.log("pay-link", JSON.stringify(r.data || r.error || ""));
    return e.json(502, { message: "Не получилось открыть оплату. Попробуйте ещё раз." });
  }
  return e.json(200, { url: r.data.Model.Url, back });
});

// Оплата картой: проверка платежа после виджета и добор «висящих» оплат раз в минуту.

// Сайт зовёт сразу после успешной оплаты в виджете
routerAdd("POST", "/api/shop/pay-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const body = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(body.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  const paid = pay.checkOrder($app, o) || o.get("payment_status") === "paid";
  // счёт отдаём сайту: окно оплаты должно выставить ровно тот номер, по которому
  // мы потом ищем платёж, иначе оплата «потеряется»
  return e.json(200, { paid, number: o.get("number"), invoice: shop.invoiceOf(o) });
});

// Состояние заказа по его коду — единственный источник правды для покупателя.
// Страница заказа на сайте только показывает то, что ответил сервер: не память браузера,
// не обработчики окна оплаты и не кнопка «Вернуться в магазин» у банка.
// Код (tg_code) случайный и в адресе не угадывается; отдаём только то, что покупатель и так знает.
routerAdd("GET", "/api/shop/order/{code}", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const code = String(e.request.pathValue("code") || "");
  if (code.length < 6) return e.json(404, { message: "Заказ не найден" });
  let o;
  try { o = $app.findFirstRecordByFilter("orders", "tg_code = {:c}", { c: code }); }
  catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  // если ждём оплату — заодно спрашиваем банк прямо сейчас, не дожидаясь ежеминутной проверки
  if (o.get("payment_method") === "card" && o.get("payment_status") === "unpaid") {
    try { pay.checkOrder($app, o); } catch (err) { console.log("order check", err); }
  }
  const s = shop.settings($app);
  return e.json(200, {
    number: o.get("number"),
    total: o.get("total"),
    status: o.get("status"),
    status_text: shop.STATUS[o.get("status")] || o.get("status"),
    payment_method: o.get("payment_method"),
    payment_status: o.get("payment_status"),
    paid: o.get("payment_status") === "paid",
    delivery_type: o.get("delivery_type"),
    when: shop.whenText(o),
    address: o.get("address"),
    bot: s.get("tg_client_bot") || s.get("tg_bot") || "",
    max_bot: s.get("max_token") ? (s.get("max_bot") || "") : "",
    code,
  });
});

// Служебное: что банк отдаёт за день. Нужно для сверки кассы — сначала проверяем,
// каким запросом и в каком виде приходят платежи.
routerAdd("POST", "/api/shop/cp-day", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  if (!shop.can(e, ["owner"])) return e.json(403, { message: "Только владелец." });
  const b = e.requestInfo().body || {};
  const date = String(b.date || "").trim();          // ГГГГ-ММ-ДД
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return e.json(400, { message: "Дата в виде ГГГГ-ММ-ДД" });
  let br = null;
  try { if (b.brand) br = $app.findRecordById("brands", String(b.brand)); } catch (_) {}
  const path = String(b.path || "/payments/list");
  const r = pay.cp(shop.settings($app), path, { Date: date, TimeZone: "MSK" }, br);
  if (!r.ok) return e.json(400, { message: r.error, путь: path });
  const rows = (r.data && r.data.Model) || [];
  const ok = rows.filter((x) => x.Status === "Completed" || x.Status === "Authorized");
  return e.json(200, {
    успех: !!(r.data && r.data.Success),
    всего: rows.length,
    прошедших: ok.length,
    сумма: ok.reduce((a, x) => a + (+x.Amount || 0), 0),
    тестовых: rows.filter((x) => x.TestMode).length,
    пример: rows.slice(0, b.all ? 200 : 3).map((x) => ({ счёт: x.InvoiceId, сумма: x.Amount, статус: x.Status, тест: x.TestMode, когда: x.CreatedDateIso || x.CreatedDate, карта: x.CardLastFour, телефон: x.AccountId })),
  });
}, $apis.requireAuth("managers"));

// Сверка кассы: раз в сутки сравниваем, что сайт посчитал оплаченным, с тем,
// что реально пришло в банк по каждому терминалу. Сервер живёт по Гринвичу,
// поэтому 06:10 здесь — это 09:10 по Москве.
cronAdd("cash-check", "10 6 * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const cash = require(`${__hooks}/lib/cash.js`);
  try {
    const s = shop.settings($app);
    const day = cash.yesterday();
    const parts = cash.report($app, day);
    const msg = cash.text(day, parts);
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat, text: msg }));
  } catch (err) {
    console.log("cash-check", err);
    require(`${__hooks}/lib/err.js`).note($app, "Сверка кассы", String(err), "");
  }
});

// Та же сверка по кнопке: за любой день, с показом результата и без отправки в бот
routerAdd("POST", "/api/shop/cash-check", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const cash = require(`${__hooks}/lib/cash.js`);
  if (!shop.can(e, ["owner"])) return e.json(403, { message: "Только владелец." });
  const b = e.requestInfo().body || {};
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || "")) ? String(b.date) : cash.yesterday();
  const parts = cash.report($app, day);
  const msg = cash.text(day, parts);
  if (b.send) shop.adminIds(shop.settings($app)).forEach((chat) => shop.tg(shop.settings($app).get("tg_token"), "sendMessage", { chat_id: chat, text: msg }));
  return e.json(200, { day, text: msg, parts: parts.map((p) => ({
    витрина: p.name, ошибка: p.error, сайт: p.ourSum, банк: p.bankSum,
    заказов: p.count, платежей: p.bankCount,
    без_денег: (p.пусто || []).map((o) => o.get("number")),
    проморгали: p.проморгали || [], чужих: p.чужих || 0, чужая_сумма: p.чужаяСумма || 0 })) });
}, $apis.requireAuth("managers"));

// Оплата могла пройти, а браузер закрыться — дочищаем сами
cronAdd("pay-poll", "* * * * *", () => {
  const pay = require(`${__hooks}/lib/pay.js`);
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  // ключи могут быть не в общих настройках, а у витрины — тогда сверка тоже нужна
  let anyKeys = !!(s.get("cp_public_id") && s.get("cp_secret"));
  if (!anyKeys) {
    try { anyKeys = $app.findRecordsByFilter("brands", "cp_public_id != '' && cp_secret != ''", "", 1, 0).length > 0; } catch (_) {}
  }
  if (!anyKeys) return;
  const since = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const list = $app.findRecordsByFilter("orders", `payment_method = "card" && payment_status = "unpaid" && created > {:since}`, "-created", 50, 0, { since });
  list.forEach((o) => { try { pay.checkOrder($app, o); } catch (err) { console.log("pay-poll", err); require(`${__hooks}/lib/err.js`).note($app, "Оплата", String(err), "проверка платежей"); } });
});

// Служебная проверка: что банк отвечает по номеру счёта. Только смотрим, ничего не меняем.
routerAdd("POST", "/api/shop/cp-find", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const b = e.requestInfo().body || {};
  const inv = String(b.invoice || "").trim();
  if (!inv) return e.json(400, { message: "Укажите номер счёта" });
  // терминал выбираем по витрине, если её передали
  let br = null;
  try { if (b.brand) br = $app.findRecordById("brands", String(b.brand)); } catch (_) {}
  let r = pay.cp(shop.settings($app), "/v2/payments/find", { InvoiceId: inv }, br);
  if (!r.ok) return e.json(400, { message: r.error });
  let m = (r.data && r.data.Model) || null;
  // вбили голый номер, а счёт ушёл с буквой витрины — поищем и так
  if (!m && /^\d+$/.test(inv)) {
    let o = null;
    try { o = $app.findFirstRecordByFilter("orders", "number = {:n}", { n: +inv }); } catch (_) {}
    const alt = o ? shop.invoiceOf(o) : "";
    if (alt && alt !== inv) {
      const r2 = pay.cp(shop.settings($app), "/v2/payments/find", { InvoiceId: alt }, br || shop.brandOfOrder($app, o));
      if (r2.ok && r2.data && r2.data.Model) { r = r2; m = r2.data.Model; }
    }
  }
  return e.json(200, {
    success: !!(r.data && r.data.Success),
    message: (r.data && r.data.Message) || "",
    payment: m ? {
      id: m.TransactionId, status: m.Status, amount: m.Amount, currency: m.Currency,
      created: m.CreatedDateIso || m.CreatedDate, confirmed: m.ConfirmDateIso || m.ConfirmDate,
      invoice: m.InvoiceId, account: m.AccountId, test: m.TestMode,
      reason: m.Reason || "", card: m.CardLastFour || "",
    } : null,
  });
}, $apis.requireAuth("managers"));

// Кнопка «Проверить оплату» в админке
routerAdd("POST", "/api/shop/cp-test", (e) => {
  const _s = require(`${__hooks}/lib/shop.js`);
  if (_s.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const shop = require(`${__hooks}/lib/shop.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  const r = pay.test(shop.settings($app));
  return r.ok ? e.json(200, { ok: true }) : e.json(400, { message: r.error });
}, $apis.requireAuth("managers"));
