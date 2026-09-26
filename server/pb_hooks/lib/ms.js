// МойСклад: заказ с сайта превращается в «Заказ покупателя».
// На каждого покупателя заводится контрагент (ищем по телефону, иначе создаём).
const shop = require(`${__hooks}/lib/shop.js`);

const BASE = "https://api.moysklad.ru/api/remap/1.2";
const meta = (type, id) => ({ meta: { href: `${BASE}/entity/${type}/${id}`, type, mediaType: "application/json" } });

function ms(s, method, path, body) {
  const token = s.get("ms_token");
  if (!token) return { ok: false, error: "Не указан токен МоегоСклада." };
  try {
    // Accept-Encoding не ставим: Go сам просит gzip (МойСклад без него отвечает 415) и сам распаковывает
    const headers = { "Authorization": "Bearer " + token };
    if (body) headers["content-type"] = "application/json;charset=utf-8";   // на GET МойСклад отвечает 415
    const res = $http.send({
      url: BASE + path,
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers,
      timeout: 40,
    });
    if (res.statusCode === 401) return { ok: false, error: "Токен МоегоСклада не подошёл." };
    if (res.statusCode >= 400) {
      const msg = res.json && res.json.errors && res.json.errors[0] ? res.json.errors[0].error : `ошибка ${res.statusCode}`;
      return { ok: false, error: `МойСклад: ${msg}` };
    }
    if (!res.json) return { ok: false, error: "МойСклад ответил непонятно. Попробуйте ещё раз." };
    return { ok: true, data: res.json };
  } catch (err) {
    console.log("moysklad", path, err);
    return { ok: false, error: "Нет связи с МоимСкладом." };
  }
}

// Организации и склады — чтобы выбрать в админке
function refs(s) {
  const org = ms(s, "GET", "/entity/organization?limit=100");
  if (!org.ok) return org;
  const store = ms(s, "GET", "/entity/store?limit=100");
  if (!store.ok) return store;
  const pick = (r) => (r.data.rows || []).map((x) => ({ id: x.id, name: x.name }));
  return { ok: true, organizations: pick(org), stores: pick(store) };
}

const digits = (p) => String(p || "").replace(/\D/g, "").replace(/^8/, "7");

// Контрагент: ищем по телефону, иначе создаём нового
function agent(s, order) {
  const phone = digits(order.get("phone"));
  if (phone) {
    const found = ms(s, "GET", `/entity/counterparty?filter=phone~${encodeURIComponent(phone.slice(-10))}&limit=1`);
    if (found.ok && found.data.rows && found.data.rows.length) return { ok: true, id: found.data.rows[0].id };
  }
  const created = ms(s, "POST", "/entity/counterparty", {
    name: order.get("name") || `Покупатель +${phone}`,
    phone: order.get("phone") || "",
    actualAddress: order.get("delivery_type") === "pickup" ? "" : order.get("address") || "",
    description: "Создан автоматически с сайта venikoff.net",
    tags: ["сайт"],
  });
  if (!created.ok) return created;
  return { ok: true, id: created.data.id };
}

// Как называется размер: «60см 51шт», «25шт», «M»
function sizeText(label) {
  const l = String(label || "");
  if (/^\d+-\d+$/.test(l)) { const [L, C] = l.split("-"); return `${L}см ${C}шт`; }
  if (/^\d+$/.test(l)) return `${l}шт`;
  return l;
}

// Ожидаемое название в МоёмСкладе: «ЛФ-Пич Аваланж 60см» (количество — это количество позиций)
function msName(s, item) {
  const prefix = (s.get("ms_prefix") || "").trim();
  const head = prefix ? (/[-_]$/.test(prefix) ? prefix + item.name : prefix + " " + item.name) : item.name;
  const len = (String(item.label || "").match(/^(\d+)-\d+$/) || [])[1];
  return [head, len ? `${len}см` : ""].filter(Boolean).join(" ");
}

// Сколько стеблей и цена за стебель
function stemsOf(item) {
  const m = String(item.label || "").match(/^(\d+)-(\d+)$/);
  const cnt = m ? +m[2] : (/^\d+$/.test(String(item.label || "")) ? +item.label : 1);
  return { cnt, price: item.price / cnt };
}

const norm = (x) => String(x || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();

// Ищем самую подходящую номенклатуру среди уже существующих (создавать новую нельзя).
// Обязательное условие — название начинается с приставки (ЛФ).
function matchProduct(s, item) {
  const prefix = (s.get("ms_prefix") || "").trim();
  const wanted = msName(s, item);
  const exact = ms(s, "GET", `/entity/product?filter=name=${encodeURIComponent(wanted)}&limit=1`);
  if (exact.ok && exact.data.rows && exact.data.rows.length) return { ok: true, id: exact.data.rows[0].id, name: exact.data.rows[0].name };

  // Ищем несколькими запросами: целиком и по частям. На сайте сорт бывает записан
  // через дробь — «Черри/Чири», а МойСклад по строке со слэшем не находит ничего.
  // Собираем находки со всех запросов: по «Черри» и по «Чири» приходят разные сорта,
  // и выбирать между ними должен подсчёт очков, а не то, что нашлось первым.
  const terms = [];
  const addTerm = (t) => {
    t = String(t || "").trim();
    if (t.length > 2 && terms.indexOf(t) < 0 && terms.length < 4) terms.push(t);
  };
  addTerm(item.name);
  String(item.name || "").split(/[\/,()]+/).forEach(addTerm);
  String(item.name || "").split(/\s+/).filter((w) => w.length > 3).forEach(addTerm);

  const rows = [], seenId = {};
  for (const term of terms) {
    const found = ms(s, "GET", `/entity/product?search=${encodeURIComponent(term)}&limit=100`);
    if (!found.ok) return found;
    (found.data.rows || []).forEach((r) => {
      if (seenId[r.id]) return;
      if (prefix && norm(r.name).indexOf(norm(prefix)) !== 0) return;
      seenId[r.id] = 1;
      rows.push(r);
    });
  }
  if (!rows.length) return { ok: false, error: `Не нашёл в МоёмСкладе номенклатуру «${wanted}». Добавьте её или переименуйте товар на сайте.` };

  const words = norm(item.name).split(" ").filter((w) => w.length > 2);
  const size = sizeText(item.label);
  const [len, cnt] = /^\d+-\d+$/.test(String(item.label || "")) ? String(item.label).split("-") : [null, null];
  const scored = rows.map((r) => {
    const n = norm(r.name);
    let score = words.filter((w) => n.indexOf(w) >= 0).length * 3;
    if (len && (n.indexOf(len + "см") >= 0 || n.indexOf(len + " см") >= 0)) score += 6;
    if (len && (n.indexOf((+len + 10) + "см") >= 0 || n.indexOf((+len - 10) + "см") >= 0)) score -= 4;   // другая длина — хуже
    if (!len && size && n.indexOf(norm(size)) >= 0) score += 6;
    if (item.wantPrice && n.indexOf(String(item.wantPrice)) >= 0) score += 8;
    return { id: r.id, name: r.name, score };
  }).sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score < 3) return { ok: false, error: `Не нашёл подходящую номенклатуру для «${wanted}».` };
  // Двое с одинаковым счётом — молча выбирать нельзя: отгрузят не тот сорт.
  const rivals = scored.filter((x) => x.score === scored[0].score);
  if (rivals.length > 1) {
    return { ok: false, error: `Для «${item.name}» подходят сразу несколько: ${rivals.slice(0, 3).map((r) => `«${r.name}»`).join(" и ")}. Переименуйте товар на сайте точнее — иначе отгрузят не тот сорт.` };
  }
  return { ok: true, id: scored[0].id, name: scored[0].name };
}

// Код товара запоминаем отдельно для каждого размера
function assortment(app, s, item) {
  let p = null;
  try { p = app.findRecordById("products", item.id); } catch (_) {}
  const key = String(item.label || "-");
  let ids = {};
  if (p) { try { ids = JSON.parse(p.getString("ms_ids") || "{}") || {}; } catch (_) { ids = {}; } }
  if (ids[key]) return { ok: true, id: ids[key] };

  let m = matchProduct(s, item);
  const first = m;   // ошибку показываем про сам товар: запасной вариант ищет по разделу
  // запасной вариант для открыток и игрушек: ищем по разделу и цене, например «ЛФ-Открытка 200»
  if (!m.ok && p) {
    let catName = "";
    try { catName = app.findRecordById("categories", p.get("category")).get("name"); } catch (_) {}
    if (catName) {
      const single = catName.replace(/и$/i, "а").replace(/ки$/i, "ка");
      m = matchProduct(s, { name: `${single} ${Math.round(item.price)}`, label: "", price: item.price }) ;
      if (!m.ok) m = matchProduct(s, { name: single, label: "", price: item.price, wantPrice: Math.round(item.price) });
    }
  }
  if (!m.ok) return first;
  if (p) { ids[key] = m.id; p.set("ms_ids", ids); app.save(p); }
  return { ok: true, id: m.id };
}

// Статус заказа в МоёмСкладе: «Принят, Оплачен» или «Принят, Не оплачен»
function stateId(s, paid) {
  const md = ms(s, "GET", "/entity/customerorder/metadata");
  if (!md.ok) return null;
  const want = paid ? "оплачен" : "не оплачен";
  const states = md.data.states || [];
  const found = states.find((x) => {
    const n = norm(x.name);
    return n.indexOf("принят") >= 0 && (paid ? n.indexOf("не оплачен") < 0 && n.indexOf("оплачен") >= 0 : n.indexOf("не оплачен") >= 0);
  });
  return found ? found.id : null;
}

// Услуга доставки: «ЛФ-Доставка Москва»
function deliveryService(s) {
  const name = (s.get("ms_delivery_name") || "").trim();
  if (!name) return null;
  const exact = ms(s, "GET", `/entity/service?filter=name=${encodeURIComponent(name)}&limit=1`);
  if (exact.ok && exact.data.rows && exact.data.rows.length) return exact.data.rows[0].id;
  const found = ms(s, "GET", `/entity/service?search=${encodeURIComponent(name)}&limit=20`);
  if (!found.ok) return null;
  const rows = (found.data.rows || []).filter((r) => norm(r.name).indexOf(norm(name)) >= 0);
  return rows.length ? rows[0].id : null;
}

// Доп. поля заказа: ищем по названию, значения справочников — по названию значения
function attrMeta(id) {
  return { meta: { href: `${BASE}/entity/customerorder/metadata/attributes/${id}`, type: "attributemetadata", mediaType: "application/json" } };
}
function customValue(s, attr, valueName) {
  if (!attr.customEntityMeta || !valueName) return null;
  const dict = String(attr.customEntityMeta.href).split("/").pop();
  const list = ms(s, "GET", `/entity/customentity/${dict}?limit=100`);
  if (!list.ok) return null;
  const want = norm(valueName);
  const row = (list.data.rows || []).find((r) => norm(r.name) === want) ||
              (list.data.rows || []).find((r) => norm(r.name).indexOf(want) >= 0);
  if (!row) return null;
  return { meta: { href: `${BASE}/entity/customentity/${dict}/${row.id}`, type: "customentity", mediaType: "application/json" } };
}
function buildAttributes(s, o) {
  const md = ms(s, "GET", "/entity/customerorder/metadata/attributes");
  if (!md.ok) return [];
  const rows = md.data.rows || [];
  const byName = (name) => rows.find((r) => norm(r.name) === norm(name));
  const pickup = o.get("delivery_type") === "pickup";
  const paidCard = o.get("payment_method") === "card";
  const out = [];
  const add = (name, value) => {
    const a = byName(name);
    if (!a || value === null || value === undefined || value === "") return;
    out.push(Object.assign(attrMeta(a.id), { value: a.type === "customentity" ? customValue(s, a, value) : value }));
  };
  const addEntity = (name, valueName) => {
    const a = byName(name);
    if (!a) return;
    const v = customValue(s, a, valueName);
    if (v) out.push(Object.assign(attrMeta(a.id), { value: v }));
  };
  addEntity("Способ доставки", pickup ? "Самовывоз" : "Доставка");
  addEntity("Тип Оплаты", paidCard ? (s.get("ms_pay_card") || "CloudPayments") : (s.get("ms_pay_cash") || "Наличные/карта на ТТ"));
  add("Время доставки", o.get("interval") || "");
  add("Получатель", o.get("recipient") || "");
  add("Текст открытки", o.get("note") || "");
  add("Имя покупателя", o.get("name") || "");
  add("Телефон покупателя", o.get("phone") || "");
  const delivery = o.get("delivery_price") || 0;
  if (delivery > 0) add("Стоимость доставки", delivery);
  return out.filter((x) => x.value !== null && x.value !== undefined);
}

// Канал продаж
function channelId(s) {
  const name = (s.get("ms_channel") || "").trim();
  if (!name) return null;
  const list = ms(s, "GET", `/entity/saleschannel?limit=100`);
  if (!list.ok) return null;
  const want = norm(name);
  const row = (list.data.rows || []).find((r) => norm(r.name) === want) || (list.data.rows || []).find((r) => norm(r.name).indexOf(want) >= 0);
  return row ? row.id : null;
}

// Адрес доставки как структурированное поле
function addressFull(o) {
  if (o.get("delivery_type") === "pickup") return null;
  const raw = String(o.get("address") || "").trim();
  if (!raw) return null;
  const hasCity = /москва/i.test(raw);
  const street = hasCity ? raw.replace(/^\s*(г\.?\s*)?москва\s*,?\s*/i, "") : raw;
  return { city: hasCity ? "Москва" : "", street: street || raw, comment: "" };
}

function orderDescription(o) {
  const parts = [
    `Заказ №${o.get("number")} с сайта venikoff.net`,
    o.get("delivery_type") === "pickup" ? `Самовывоз: ${o.get("address")}` : `Доставка: ${o.get("address")}`,
    `Когда: ${o.get("date")}, ${o.get("interval") || "время не выбрано"}`,
    `Заказчик: ${o.get("name")}, ${o.get("phone")}`,
    o.get("recipient") ? `Получатель: ${o.get("recipient")}` : "",
    o.get("note") ? `Открытка: ${o.get("note")}` : "",
    o.get("payment_method") === "card"
      ? (o.get("payment_status") === "paid" ? "Оплачено картой на сайте" : "Ожидает оплаты картой")
      : "Оплата при получении",
    `Доставка: ${shop.rub(o.get("delivery_price") || 0)}. Итого: ${shop.rub(o.get("total") || 0)}`,
  ];
  return parts.filter(Boolean).join("\n");
}

// Отправка одного заказа. Возвращает { ok, id } или { ok: false, error }
// Замок на действие с заказом: вставка второй такой строки не проходит,
// поэтому два одновременных вызова не создадут в МоёмСкладе два одинаковых документа.
function claim(app, id, kind) {
  try {
    app.db().newQuery("INSERT INTO order_locks (order_id, kind, at) VALUES ({:id}, {:k}, {:t})")
      .bind({ id, k: kind, t: new Date().toISOString() }).execute();
    return true;
  } catch (_) { return false; }
}
function unclaim(app, id, kind) {
  try { app.db().newQuery("DELETE FROM order_locks WHERE order_id = {:id} AND kind = {:k}").bind({ id, k: kind }).execute(); } catch (_) {}
}

function pushOrder(app, o) {
  const s = shop.settings(app);
  if (!s.get("ms_enabled") || !s.get("ms_token")) return { ok: false, error: "Интеграция выключена." };
  if (o.get("ms_id")) return { ok: true, id: o.get("ms_id") };
  // доставку оформляем в МоёмСкладе только после оплаты; самовывоз — сразу
  if (o.get("delivery_type") !== "pickup" && o.get("payment_status") !== "paid") {
    return { ok: false, wait: true, error: "Ждём оплату — заказ уйдёт в МойСклад после неё." };
  }
  if (!s.get("ms_org_id") || !s.get("ms_store_id")) return { ok: false, error: "Не выбраны организация и склад." };

  const a = agent(s, o);
  if (!a.ok) return a;

  const items = shop.jget(o, "items") || [];
  const positions = [];
  let posKop = 0, itemsKop = 0;
  for (const it of items) {
    const as = assortment(app, s, it);
    if (!as.ok) return as;
    const st = stemsOf(it);   // в МоёмСкладе номенклатура — стебель: количество стеблей и цена за стебель
    const qty = st.cnt * it.qty;
    const priceKop = Math.round(st.price * 100);
    positions.push({ quantity: qty, price: priceKop, assortment: meta("product", as.id) });
    posKop += priceKop * qty;
    itemsKop += Math.round(it.price * 100) * it.qty;
  }
const delivery = o.get("delivery_price") || 0;
if (delivery > 0) {
  const svc = deliveryService(s);
  // копейки, потерянные при делении цены букета на стебли, добавляем к доставке — итог сходится с сайтом
  const kop = Math.round(delivery * 100) + (itemsKop - posKop);
  if (svc) positions.push({ quantity: 1, price: kop, assortment: meta("service", svc) });
}

  const body = {
    name: String(o.get("number")),
    organization: meta("organization", s.get("ms_org_id")),
    store: meta("store", s.get("ms_store_id")),
    agent: meta("counterparty", a.id),
    description: orderDescription(o),
    deliveryPlannedMoment: `${o.get("date")} ${(o.get("interval") || "12:00").slice(0, 5)}:00`,
    positions,
    shipmentAddress: o.get("delivery_type") === "pickup" ? "" : o.get("address") || "",
  vatEnabled: false,
attributes: buildAttributes(s, o),
};
const ch = channelId(s);
if (ch) body.salesChannel = meta("saleschannel", ch);
const addr = addressFull(o);
if (addr) body.shipmentAddressFull = addr;
const st = stateId(s, o.get("payment_status") === "paid");
if (st) body.state = meta("state", st);

  // Берём замок перед самой отправкой: до этого заказ мог не пройти проверки
  if (!claim(app, o.id, "push")) return { ok: false, wait: true, error: "Заказ уже отправляется в МойСклад." };
  const created = ms(s, "POST", "/entity/customerorder", body);
  if (!created.ok) { unclaim(app, o.id, "push"); return created; }
  o.set("ms_id", created.data.id);
  o.set("ms_error", "");
  app.save(o);
  // и запросом тоже: соседнее сохранение из копии, прочитанной раньше, затёрло бы
  // номер обратно в пустоту, и очередь отправила бы заказ в МойСклад второй раз
  try {
    app.db().newQuery("UPDATE orders SET ms_id = {:v} WHERE id = {:id}").bind({ v: created.data.id, id: o.id }).execute();
  } catch (err) { console.log("ms_id", err); }
  return { ok: true, id: created.data.id };
}

// Входящий платёж в МоёмСкладе, привязанный к заказу покупателя
function addPayment(app, o) {
  const s = shop.settings(app);
  if (!o.get("ms_id") || !s.get("ms_token") || o.get("ms_payment_id")) return { ok: false };
  const ord = ms(s, "GET", `/entity/customerorder/${o.get("ms_id")}`);
  if (!ord.ok) return ord;
  const agentHref = ord.data.agent && ord.data.agent.meta && ord.data.agent.meta.href;
  if (!agentHref) return { ok: false, error: "У заказа в МоёмСкладе нет контрагента." };
  if (!claim(app, o.id, "payment")) return { ok: false, wait: true, error: "Платёж уже проводится." };
  const created = ms(s, "POST", "/entity/paymentin", {
    organization: meta("organization", s.get("ms_org_id")),
    agent: { meta: { href: agentHref, type: "counterparty", mediaType: "application/json" } },
    sum: Math.round((o.get("total") || 0) * 100),
    paymentPurpose: `Оплата заказа №${o.get("number")} на сайте venikoff.net (CloudPayments${o.get("payment_id") ? ", операция " + o.get("payment_id") : ""})`,
    operations: [{ meta: { href: `${BASE}/entity/customerorder/${o.get("ms_id")}`, type: "customerorder", mediaType: "application/json" }, linkedSum: Math.round((o.get("total") || 0) * 100) }],
  });
  if (!created.ok) { unclaim(app, o.id, "payment"); return created; }
  o.set("ms_payment_id", created.data.id);
  app.save(o);
  try {
    app.db().newQuery("UPDATE orders SET ms_payment_id = {:v} WHERE id = {:id}").bind({ v: created.data.id, id: o.id }).execute();
  } catch (err) { console.log("ms_payment_id", err); }
  return { ok: true, id: created.data.id };
}

// Перевести уже созданный заказ в «Принят, Оплачен»
function markPaid(app, o) {
  const s = shop.settings(app);
  if (!o.get("ms_id") || !s.get("ms_token")) return { ok: false };
  const st = stateId(s, true);
  if (!st) return { ok: false };
  return ms(s, "PUT", `/entity/customerorder/${o.get("ms_id")}`, { state: meta("state", st) });
}

module.exports = { ms, refs, pushOrder, channelId, msName, matchProduct, stemsOf, markPaid, addPayment, deliveryService };
