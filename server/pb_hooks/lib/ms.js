// МойСклад: заказ с сайта превращается в «Заказ покупателя».
// На каждого покупателя заводится контрагент (ищем по телефону, иначе создаём).
const shop = require(`${__hooks}/lib/shop.js`);

const BASE = "https://api.moysklad.ru/api/remap/1.2";
const meta = (type, id) => ({ meta: { href: `${BASE}/entity/${type}/${id}`, type, mediaType: "application/json" } });

function ms(s, method, path, body) {
  const token = s.get("ms_token");
  if (!token) return { ok: false, error: "Не указан токен МоегоСклада." };
  try {
    const res = $http.send({
      url: BASE + path,
      method,
      body: body ? JSON.stringify(body) : undefined,
      headers: { "Authorization": "Bearer " + token, "content-type": "application/json;charset=utf-8", "Accept-Encoding": "gzip" },
      timeout: 40,
    });
    if (res.statusCode === 401) return { ok: false, error: "Токен МоегоСклада не подошёл." };
    if (res.statusCode >= 400) {
      const msg = res.json && res.json.errors && res.json.errors[0] ? res.json.errors[0].error : `ошибка ${res.statusCode}`;
      return { ok: false, error: `МойСклад: ${msg}` };
    }
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

// Товар в МоёмСкладе: берём сохранённый id, иначе ищем по названию, иначе создаём
function assortment(app, s, item) {
  let p = null;
  try { p = app.findRecordById("products", item.id); } catch (_) {}
  if (p && p.get("ms_id")) return { ok: true, id: p.get("ms_id") };
  const name = item.name;
  const found = ms(s, "GET", `/entity/product?filter=name=${encodeURIComponent(name)}&limit=1`);
  if (found.ok && found.data.rows && found.data.rows.length) {
    const id = found.data.rows[0].id;
    if (p) { p.set("ms_id", id); app.save(p); }
    return { ok: true, id };
  }
  const created = ms(s, "POST", "/entity/product", {
    name,
    salePrices: [{ value: Math.round(item.price * 100), priceType: undefined }],
    description: "Создан автоматически с сайта venikoff.net",
  });
  if (!created.ok) return created;
  if (p) { p.set("ms_id", created.data.id); app.save(p); }
  return { ok: true, id: created.data.id };
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
    positions.push({ quantity: it.qty, price: Math.round(it.price * 100), assortment: meta("product", as.id) });
  }
  const delivery = o.get("delivery_price") || 0;

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
  if (delivery > 0) body.shippingCost = Math.round(delivery * 100);

  const created = ms(s, "POST", "/entity/customerorder", body);
  if (!created.ok) return created;
  o.set("ms_id", created.data.id);
  o.set("ms_error", "");
  app.save(o);
  return { ok: true, id: created.data.id };
}

module.exports = { ms, refs, pushOrder };
