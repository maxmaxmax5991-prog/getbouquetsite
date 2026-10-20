/// <reference path="../pb_data/types.d.ts" />
// Правка заказа руками менеджера: состав, данные, отмена, доплата.
//
// Почему отдельным обработчиком, а не прямой записью из админки:
//   — цену считает сервер. Пришедшей из браузера сумме верить нельзя, как и
//     при оформлении: иначе букет уедет за ту цену, которую подставили.
//   — каждое изменение ложится в журнал. Правка мимо журнала бессмысленна:
//     весь смысл в том, чтобы видеть, кто что поменял.
//   — после правки заказ переотправляется в МойСклад, иначе там останется
//     старый состав и флорист соберёт не то.

// Состав и данные заказа.
routerAdd("POST", "/api/shop/order-edit", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const я = st.нынешний($app, e);
  const b = e.requestInfo().body || {};
  const s = shop.settings($app);

  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  if (o.get("status") === "cancelled") return e.json(400, { message: "Заказ отменён — его больше не правят." });

  const правки = [];
  const раньшеСумма = +o.get("total") || 0;

  // --- состав ---
  if (Array.isArray(b.items)) {
    if (!b.items.length) return e.json(400, { message: "В заказе должна остаться хотя бы одна позиция." });
    if (b.items.length > 50) return e.json(400, { message: "Слишком много позиций." });
    const было = shop.jget(o, "items") || [];
    const стало = [];
    let сумма = 0;
    for (const it of b.items) {
      let p;
      try { p = $app.findRecordById("products", String(it.id || "")); } catch (_) { return e.json(400, { message: "Один из сортов не найден." }); }
      const qty = Math.floor(+it.qty || 0);
      if (!(qty >= 1 && qty <= 99)) return e.json(400, { message: `Неверное количество у «${p.get("name")}».` });
      const варианты = shop.variantsOf(p, s);
      let цена = p.get("price"), label = "";
      if (варианты.length) {
        const v = варианты.find((x) => x.label === String(it.label || ""));
        if (!v) return e.json(400, { message: `У «${p.get("name")}» нет размера «${it.label}».` });
        цена = v.price; label = v.label;
      }
      if (!(+цена > 0)) return e.json(400, { message: `У «${p.get("name")}» не указана цена.` });
      стало.push({ id: p.id, name: p.get("name"), label, label_text: label ? shop.labelText(label) : "",
        price: +цена, qty, sum: +цена * qty });
      сумма += +цена * qty;
    }
    // Остатки при правке НЕ трогаем: заказ уже их занял при оформлении, а
    // пересчитывать разницу по каждой ростовке — отдельная история, и ошибка
    // там дороже, чем небольшая неточность в остатке. Владелец правит остатки
    // руками каждое утро, расхождение уйдёт там же.
    const словами = (сп) => (сп || []).map((x) => `${x.name}${x.label_text ? " " + x.label_text : ""} ×${x.qty}`).join(", ");
    if (JSON.stringify(было) !== JSON.stringify(стало)) правки.push(["состав", `${словами(было)} → ${словами(стало)}`]);
    o.set("items", стало);
    o.set("items_sum", сумма);
    o.set("total", сумма + (+o.get("delivery_price") || 0));
  }

  // --- данные ---
  const поля = [["name", "имя"], ["phone", "телефон"], ["recipient", "получатель"], ["address", "адрес"],
    ["date", "дата"], ["interval", "интервал"], ["note", "открытка"], ["delivery_note", "курьеру"], ["comment", "заметка"]];
  поля.forEach(([k, название]) => {
    if (b[k] === undefined) return;
    const было = String(o.get(k) || ""), стало = String(b[k] || "").slice(0, 500);
    if (было === стало) return;
    o.set(k, стало);
    правки.push([название, `${было || "пусто"} → ${стало || "пусто"}`]);
  });

  // Цену доставки меняем отдельно и только руками: пересчёт по адресу требует
  // геокодера, а менеджер и так видит, сколько должно быть.
  if (b.delivery_price !== undefined) {
    const было = +o.get("delivery_price") || 0, стало = Math.max(0, Math.round(+b.delivery_price || 0));
    if (было !== стало) {
      o.set("delivery_price", стало);
      o.set("total", (+o.get("items_sum") || 0) + стало);
      правки.push(["доставка", `${было} → ${стало} ₽`]);
    }
  }

  if (!правки.length) return e.json(200, { ok: true, ничего: true });

  try { $app.save(o); } catch (err) { return e.json(400, { message: String(err) }); }
  правки.forEach(([что, текст]) => st.запись($app, o, я, что, текст));

  // МойСклад: пересобираем состав и доп. поля. Делаем это после сохранения,
  // иначе туда уедет старая копия.
  let склад = "";
  if (o.get("ms_id")) {
    try {
      const msl = require(`${__hooks}/lib/ms.js`);
      const r1 = msl.syncPositions($app, o);
      const r2 = msl.updateAttrs($app, o);
      склад = (r1 && r1.ok === false) ? String(r1.error || "не вышло") : (r2 && r2.ok === false ? String(r2.error || "не вышло") : "обновлён");
    } catch (err) { склад = String(err); }
    st.запись($app, o, null, "МойСклад", склад);
  }

  const стала = +o.get("total") || 0;
  const оплачено = o.get("payment_status") === "paid" ? раньшеСумма : 0;
  return e.json(200, {
    ok: true, total: стала, склад,
    доплата: оплачено && стала > оплачено ? стала - оплачено : 0,
    возврат: оплачено && стала < оплачено ? оплачено - стала : 0,
  });
}, $apis.requireAuth("managers"));

// Отмена заказа. Остатки вернёт хук в unpaid.pb.js — он уже это умеет.
routerAdd("POST", "/api/shop/order-cancel", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const я = st.нынешний($app, e);
  const b = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }
  if (o.get("status") === "cancelled") return e.json(200, { ok: true, уже: true });
  const причина = String(b.why || "").slice(0, 300);
  o.set("status", "cancelled");
  try { $app.save(o); } catch (err) { return e.json(400, { message: String(err) }); }
  st.запись($app, o, я, "отменён", причина || "без причины");
  const оплачен = o.get("payment_status") === "paid";
  return e.json(200, { ok: true, вернуть: оплачен ? +o.get("total") || 0 : 0 });
}, $apis.requireAuth("managers"));

// Доплата: счёт на разницу и ссылка клиенту.
//
// Номер счёта свой — `v4371d1`. Повторять номер заказа нельзя: сверка кассы
// сопоставляет платежи со счетами, и два платежа на один номер читаются как
// задвоение (так и вышло с №4371 — 8578 ₽ вместо 4289).
routerAdd("POST", "/api/shop/order-extra", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  const pay = require(`${__hooks}/lib/pay.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const я = st.нынешний($app, e);
  const s = shop.settings($app);
  const b = e.requestInfo().body || {};
  let o;
  try { o = $app.findRecordById("orders", String(b.order || "")); } catch (_) { return e.json(404, { message: "Заказ не найден" }); }

  const сумма = Math.round(+b.sum || 0);
  if (!(сумма > 0)) return e.json(400, { message: "Укажите сумму доплаты." });
  if (сумма > 500000) return e.json(400, { message: "Слишком большая сумма — проверьте." });

  // сколько доплат уже выставляли
  let было = [];
  try { было = $app.findRecordsByFilter("order_extras", "order = {:o}", "created", 50, 0, { o: o.id }); } catch (_) {}
  const счёт = `${shop.invoiceOf(o)}d${было.length + 1}`;

  const brand = shop.brandOfOrder($app, o);
  const site = String((brand && brand.get("domain") ? "https://" + brand.get("domain") : "") || s.get("site_url") || "").replace(/\/$/, "");
  const r = pay.cp(s, "/orders/create", {
    Amount: сумма,
    Currency: "RUB",
    Description: `Доплата по заказу №${o.get("number")} — ${(brand && brand.get("name")) || "venikoff.net"}`,
    InvoiceId: счёт,
    AccountId: String(o.get("phone") || ""),
  }, brand);
  if (!r.ok || !r.data || !r.data.Model || !r.data.Model.Url) {
    console.log("доплата", JSON.stringify(r.data || r.error || ""));
    return e.json(502, { message: "Банк не дал ссылку на оплату. Попробуйте ещё раз." });
  }
  const url = r.data.Model.Url;

  const rec = new Record($app.findCollectionByNameOrId("order_extras"));
  rec.set("order", o.id); rec.set("number", o.get("number")); rec.set("sum", сумма);
  rec.set("invoice", счёт); rec.set("url", url); rec.set("by", я ? я.id : "");
  try { $app.save(rec); } catch (err) { return e.json(500, { message: String(err) }); }

  // Ссылку отправляем клиенту сами — в тот же канал, куда идут статусы и фото.
  const текст = `По заказу №${o.get("number")} нужна доплата ${shop.rub(сумма)}.\n\nОплатить: ${url}`;
  let ушло = "";
  try {
    if (o.get("tg_chat")) { shop.tg(shop.clientToken(s, brand), "sendMessage", { chat_id: o.get("tg_chat"), text: текст }); ушло = "в Телеграм"; }
    else if (o.get("max_chat")) { require(`${__hooks}/lib/max.js`).send(s.get("max_token"), o.get("max_chat"), текст); ушло = "в MAX"; }
  } catch (err) { console.log("доплата: не отправил", err); }

  st.запись($app, o, я, "доплата", `${shop.rub(сумма)}, счёт ${счёт}${ушло ? `, ссылка ушла ${ушло}` : ", клиент не подписан на бота"}`);
  return e.json(200, { ok: true, url, счёт, ушло });
}, $apis.requireAuth("managers"));

// Что по доплатам у заказа — для карточки.
routerAdd("GET", "/api/shop/order-extras", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const st = require(`${__hooks}/lib/staff.js`);
  if (!shop.can(e, st.ЗАКАЗЫ)) return e.json(403, { message: "Недостаточно прав." });
  const id = String(e.request.url.query().get("order") || "");
  let r = [];
  try { r = $app.findRecordsByFilter("order_extras", "order = {:o}", "created", 50, 0, { o: id }); } catch (_) {}
  return e.json(200, { доплаты: r.map((x) => ({
    sum: x.get("sum"), invoice: x.get("invoice"), url: x.get("url"), paid_at: x.get("paid_at") || "",
  })) });
}, $apis.requireAuth("managers"));
