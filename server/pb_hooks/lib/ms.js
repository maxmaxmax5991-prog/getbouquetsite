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

  const found = ms(s, "GET", `/entity/product?search=${encodeURIComponent(item.name)}&limit=100`);
  if (!found.ok) return found;
  const rows = (found.data.rows || []).filter((r) => !prefix || norm(r.name).indexOf(norm(prefix)) === 0);
  if (!rows.length) return { ok: false, error: `Не нашёл в МоёмСкладе номенклатуру «${wanted}». Добавьте её или переименуйте товар на сайте.` };

  const words = norm(item.name).split(" ").filter((w) => w.length > 2);
  const size = sizeText(item.label);
  const [len, cnt] = /^\d+-\d+$/.test(String(item.label || "")) ? String(item.label).split("-") : [null, null];
  let best = null, bestScore = 0;
  rows.forEach((r) => {
    const n = norm(r.name);
    let score = words.filter((w) => n.indexOf(w) >= 0).length * 3;
    if (len && new RegExp(`\b${len}\s*см`).test(n)) score += 6;
    if (!len && size && n.indexOf(norm(size)) >= 0) score += 6;
    if (score > bestScore) { bestScore = score; best = r; }
  });
  if (!best || bestScore < 3) return { ok: false, error: `Не нашёл подходящую номенклатуру для «${wanted}».` };
  return { ok: true, id: best.id, name: best.name };
}

// Код товара запоминаем отдельно для каждого размера
function assortment(app, s, item) {
  let p = null;
  try { p = app.findRecordById("products", item.id); } catch (_) {}
  const key = String(item.label || "-");
  let ids = {};
  if (p) { try { ids = JSON.parse(p.getString("ms_ids") || "{}") || {}; } catch (_) { ids = {}; } }
  if (ids[key]) return { ok: true, id: ids[key] };

  const m = matchProduct(s, item);
  if (!m.ok) return m;
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
function pushOrder(app, o) {
  const s = shop.settings(app);
  if (!s.get("ms_enabled") || !s.get("ms_token")) return { ok: false, error: "Интеграция выключена." };
  if (o.get("ms_id")) return { ok: true, id: o.get("ms_id") };
  if (!s.get("ms_org_id") || !s.get("ms_store_id")) return { ok: false, error: "Не выбраны организация и склад." };

  const a = agent(s, o);
  if (!a.ok) return a;

  const items = shop.jget(o, "items") || [];
  const positions = [];
  for (const it of items) {
    const as = assortment(app, s, it);
    if (!as.ok) return as;
    const st = stemsOf(it);   // в МоёмСкладе номенклатура — стебель, поэтому количество стеблей и цена за стебель
    positions.push({ quantity: st.cnt * it.qty, price: Math.round(st.price * 100), assortment: meta("product", as.id) });
  }
const delivery = o.get("delivery_price") || 0;
if (delivery > 0) {
  const svc = deliveryService(s);
  if (svc) positions.push({ quantity: 1, price: Math.round(delivery * 100), assortment: meta("service", svc) });
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
};
const st = stateId(s, o.get("payment_status") === "paid");
if (st) body.state = meta("state", st);

  const created = ms(s, "POST", "/entity/customerorder", body);
  if (!created.ok) return created;
  o.set("ms_id", created.data.id);
  o.set("ms_error", "");
  app.save(o);
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

module.exports = { ms, refs, pushOrder, msName, matchProduct, stemsOf, markPaid, deliveryService };
