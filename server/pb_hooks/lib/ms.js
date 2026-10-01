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
      // 429 — не ошибка данных, а «слишком часто спрашиваете». Такое лечится
      // повтором через минуту, а не руками, поэтому помечаем отдельно.
      return { ok: false, rate: res.statusCode === 429, error: `МойСклад: ${msg}` };
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
    // Длину в МоёмСкладе пишут по-разному: «50см», «50 см» и просто «50».
    // Из-за последнего варианта «ЛФ-Роза Эльторо 40» и «…50» набирали поровну,
    // и заказ №3029 встал с «подходят сразу несколько».
    const pad = " " + n + " ";
    const hasLen = (L) => pad.indexOf(" " + L + " ") >= 0 || n.indexOf(L + "см") >= 0 || n.indexOf(L + " см") >= 0;
    if (len) {
      if (hasLen(len)) score += 6;
      [30, 40, 50, 60, 70, 80, 90, 100, 110, 120].forEach((L) => { if (L !== +len && hasLen(String(L))) score -= 4; });
    }
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
  // Ручная привязка сильнее автоподбора: её задал человек, глядя на обе базы
  if (p) {
    const pick = shop.jget(p, "ms_pick") || {};
    const len = (key.match(/^(\d+)-/) || [])[1] || "0";
    let hit = pick[len] || pick[key];
    // У товара без ростовок ключ привязки — это количество, и владелец заводит
    // её обычно для одного размера. Сорт при этом один и тот же на все размеры,
    // поэтому единственную привязку распространяем на любое количество.
    // Иначе заказ падал: у «Розовых французских роз» привязка стояла на 5 шт,
    // заказали 13 — и №3264 не ушёл в МойСклад.
    if (!hit) {
      const lengths = shop.jget(p, "lengths");
      const один = Object.keys(pick).filter((k) => pick[k] && pick[k].id);
      if (!(Array.isArray(lengths) && lengths.length) && один.length === 1) hit = pick[один[0]];
    }
    if (hit && hit.id) return { ok: true, id: hit.id };
  }
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

// Этап заказа в МоёмСкладе: «Принят, Оплачен» или «Принят, Не оплачен».
// Номер запоминаем в настройках: этапы меняются раз в год, а спрашивать их
// каждый раз — значит зависеть от связи в самый неподходящий момент. Если
// запрос не проходил, заказ уходил вообще без этапа и МойСклад ставил «Новый».
function stateId(app, s, paid) {
  const field = paid ? "ms_state_paid" : "ms_state_unpaid";
  const saved = String(s.get(field) || "").trim();
  if (saved) return saved;
  const md = ms(s, "GET", "/entity/customerorder/metadata");
  if (!md.ok) return null;
  const states = md.data.states || [];
  const found = states.find((x) => {
    const n = norm(x.name);
    return n.indexOf("принят") >= 0 && (paid ? n.indexOf("не оплачен") < 0 && n.indexOf("оплачен") >= 0 : n.indexOf("не оплачен") >= 0);
  });
  if (!found) return null;
  // пишем запросом, мимо хуков на настройках: обычное сохранение будит обработчик ботов
  try { app.db().newQuery(`UPDATE settings SET ${field} = {:v} WHERE id = {:id}`).bind({ v: found.id, id: s.id }).execute(); }
  catch (err) { console.log("ms state cache", err); }
  return found.id;
}

// то же самое, но возвращает название — для служебной проверки
function stateName(s, paid) {   // служебное: показывает название, кэш не трогает
  const md = ms(s, "GET", "/entity/customerorder/metadata");
  if (!md.ok) return "(нет связи)";
  const states = md.data.states || [];
  const found = states.find((x) => {
    const n = norm(x.name);
    return n.indexOf("принят") >= 0 && (paid ? n.indexOf("не оплачен") < 0 && n.indexOf("оплачен") >= 0 : n.indexOf("не оплачен") >= 0);
  });
  return found ? found.name : "(не нашли — МойСклад поставит свой первый этап)";
}

// Услуга доставки: «ЛФ-Доставка Москва»
// Номенклатура доставки. Номер запоминаем: раньше её искали по названию при
// каждой отправке, и под ограничением запросов строка доставки молча пропадала
// из заказа (№3195 — 2990 вместо 3789). Возвращаем {id} или {error, rate}.
function deliveryService(app, s) {
  if (s === undefined) { s = app; app = null; }          // старый вызов deliveryService(s)
  const name = String(s.get("ms_delivery_name") || "").trim();
  if (!name) return { id: null };                        // доставка в складе не ведётся — так и задумано

  const cached = String(s.get("ms_delivery_id") || "").trim();
  if (cached && app) return { id: cached };

  const save = (id) => {
    if (!app || id === cached) return;
    // пишем запросом, мимо хуков на настройках
    try { app.db().newQuery("UPDATE settings SET ms_delivery_id = {:v} WHERE id = {:id}").bind({ v: id, id: s.id }).execute(); }
    catch (err) { console.log("ms delivery cache", err); }
  };

  const exact = ms(s, "GET", `/entity/service?filter=name=${encodeURIComponent(name)}&limit=1`);
  if (exact.ok && exact.data.rows && exact.data.rows.length) { save(exact.data.rows[0].id); return { id: exact.data.rows[0].id }; }
  const found = ms(s, "GET", `/entity/service?search=${encodeURIComponent(name)}&limit=20`);
  if (!found.ok) {
    if (cached) return { id: cached };                   // связи нет — берём вчерашний номер
    return { id: null, error: found.error, rate: !!found.rate };
  }
  const rows = (found.data.rows || []).filter((r) => norm(r.name).indexOf(norm(name)) >= 0);
  if (rows.length) { save(rows[0].id); return { id: rows[0].id }; }
  return { id: null, error: `в МоёмСкладе нет услуги «${name}»` };
}

// Доп. поля заказа: ищем по названию, значения справочников — по названию значения
function attrMeta(id) {
  return { meta: { href: `${BASE}/entity/customerorder/metadata/attributes/${id}`, type: "attributemetadata", mediaType: "application/json" } };
}
// Значение справочника запоминаем: иначе каждое доп. поле — лишний запрос к складу,
// а при сбое связи поле молча остаётся пустым (так вышло с «Тип Оплаты» у №3143).
function customValue(app, s, attr, valueName) {
  if (!attr.customEntityMeta || !valueName) return null;
  const dict = String(attr.customEntityMeta.href).split("/").pop();
  const key = dict + "|" + norm(valueName);

  let cache = {};
  try { cache = shop.jget(s, "ms_dict_cache") || {}; } catch (_) { cache = {}; }
  if (cache[key]) return { meta: { href: `${BASE}/entity/customentity/${dict}/${cache[key]}`, type: "customentity", mediaType: "application/json" } };

  const list = ms(s, "GET", `/entity/customentity/${dict}?limit=1000`);
  if (!list.ok) return null;
  const want = norm(valueName);
  const row = (list.data.rows || []).find((r) => norm(r.name) === want) ||
              (list.data.rows || []).find((r) => norm(r.name).indexOf(want) >= 0);
  if (!row) return null;

  cache[key] = row.id;
  // пишем запросом, мимо хуков на настройках
  try { app.db().newQuery("UPDATE settings SET ms_dict_cache = {:v} WHERE id = {:id}").bind({ v: JSON.stringify(cache), id: s.id }).execute(); }
  catch (err) { console.log("ms dict cache", err); }
  return { meta: { href: `${BASE}/entity/customentity/${dict}/${row.id}`, type: "customentity", mediaType: "application/json" } };
}
// Список доп. полей заказа. Меняется раз в год, а спрашивался при каждой
// отправке — и в утренний вал склад отвечал 429, список не приходил, и заказ
// уезжал вообще без полей (так вышло у №3128 и №3195). Помним его час.
function attrRows(app, s) {
  let cache = null;
  try { cache = shop.jget(s, "ms_attrs_cache"); } catch (_) { cache = null; }
  const fresh = cache && cache.at && Array.isArray(cache.rows) &&
    Date.now() - Date.parse(cache.at) < 3600 * 1000;
  if (fresh) return { ok: true, rows: cache.rows };

  const md = ms(s, "GET", "/entity/customerorder/metadata/attributes");
  if (md.ok) {
    const rows = md.data.rows || [];
    // пишем запросом, мимо хуков на настройках
    try {
      app.db().newQuery("UPDATE settings SET ms_attrs_cache = {:v} WHERE id = {:id}")
        .bind({ v: JSON.stringify({ at: new Date().toISOString(), rows }), id: s.id }).execute();
    } catch (err) { console.log("ms attrs cache", err); }
    return { ok: true, rows };
  }
  // склад не ответил — работаем по вчерашнему списку, он не устаревает
  if (cache && Array.isArray(cache.rows) && cache.rows.length) return { ok: true, rows: cache.rows, stale: true };
  return { ok: false, error: md.error, rate: !!md.rate };
}

function buildAttributes(app, s, o, missed) {
  const md = attrRows(app, s);
  if (!md.ok) { if (missed) missed.push("все доп. поля (склад не ответил)"); return []; }
  const rows = md.rows || [];
  const byName = (name) => rows.find((r) => norm(r.name) === norm(name));
  const pickup = o.get("delivery_type") === "pickup";
  const paidCard = o.get("payment_method") === "card";
  const out = [];
  // Поле в МоёмСкладе может быть не текстом, а справочником — тогда значение
  // приходится искать по названию, и если его там нет, поле молча оставалось
  // пустым. Так у №3128 не ушло «Время доставки», и заказ не поехал по статусам.
  // Теперь о каждой такой пропаже говорим вслух.
  const add = (name, value) => {
    const a = byName(name);
    if (!a || value === null || value === undefined || value === "") return;
    if (a.type !== "customentity") { out.push(Object.assign(attrMeta(a.id), { value })); return; }
    const v = customValue(app, s, a, value);
    if (!v) { if (missed) missed.push(`${name} = «${value}» (нет такого значения в справочнике)`); return; }
    out.push(Object.assign(attrMeta(a.id), { value: v }));
  };
  const addEntity = (name, valueName) => {
    const a = byName(name);
    if (!a) { if (missed) missed.push(name + " (нет такого поля)"); return; }
    const v = customValue(app, s, a, valueName);
    // не нашли значение — говорим вслух, а не оставляем поле пустым молча
    if (!v) { if (missed) missed.push(`${name} = «${valueName}»`); return; }
    out.push(Object.assign(attrMeta(a.id), { value: v }));
  };
  addEntity("Способ доставки", pickup ? "Самовывоз" : "Доставка");
  addEntity("Тип Оплаты", paidCard ? (s.get("ms_pay_card") || "CloudPayments") : (s.get("ms_pay_cash") || "Наличные/карта на ТТ"));
  add("Время доставки", o.get("interval") || "");
  add("Получатель", o.get("recipient") || "");
  add("Текст открытки", o.get("note") || "");
  // просьба покупателя курьеру — отдельным полем, чтобы не смешивать с открыткой
  add("Комментарий по доставке", o.get("delivery_note") || "");
  add("Имя покупателя", o.get("name") || "");
  add("Телефон покупателя", o.get("phone") || "");
  const delivery = o.get("delivery_price") || 0;
  if (delivery > 0) add("Стоимость доставки", delivery);
  return out.filter((x) => x.value !== null && x.value !== undefined);
}

// Канал продаж
// Канал продаж. Номер запоминаем: раньше его искали по названию при каждой
// отправке, и в вал заказов склад отвечал 429 — канал молча не проставлялся.
// app может не передаваться (служебная проверка) — тогда просто не кэшируем.
function channelId(app, s) {
  if (s === undefined) { s = app; app = null; }        // старый вызов channelId(s)
  const name = String(s.get("ms_channel") || "").trim();
  if (!name) return null;

  const cached = String(s.get("ms_channel_id") || "").trim();
  if (cached && app) return cached;

  const list = ms(s, "GET", `/entity/saleschannel?limit=1000`);
  if (!list.ok) return cached || null;                 // связи нет — берём вчерашний номер
  const want = norm(name);
  const row = (list.data.rows || []).find((r) => norm(r.name) === want) ||
              (list.data.rows || []).find((r) => norm(r.name).indexOf(want) >= 0);
  if (!row) return null;
  if (app && row.id !== cached) {
    // пишем запросом, мимо хуков на настройках
    try { app.db().newQuery("UPDATE settings SET ms_channel_id = {:v} WHERE id = {:id}").bind({ v: row.id, id: s.id }).execute(); }
    catch (err) { console.log("ms channel cache", err); }
  }
  return row.id;
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
    o.get("delivery_note") ? `Курьеру: ${o.get("delivery_note")}` : "",
    o.get("payment_method") === "card"
      ? (o.get("payment_status") === "paid" ? "Оплачено картой на сайте" : "Ожидает оплаты картой")
      : "Оплата при получении",
    `Доставка: ${shop.rub(o.get("delivery_price") || 0)}. Итого: ${shop.rub(o.get("total") || 0)}`,
  ];
  return parts.filter(Boolean).join("\n");
}

// Отправка одного заказа. Возвращает { ok, id } или { ok: false, error }
const { claim, unclaim } = shop;   // замок общий, лежит в lib/shop.js

function checkItem(app, item) {
  return assortment(app, shop.settings(app), item);
}

// Позиции заказа для МоегоСклада: цветы в стеблях + доставка услугой.
// Отдельной функцией, потому что то же самое нужно при замене сорта в заказе.
function positionsFor(app, s, o) {
  const items = shop.jget(o, "items") || [];
  const positions = [];
  let posKop = 0, itemsKop = 0;
  for (const it of items) {
    itemsKop += Math.round(it.price * 100) * it.qty;

    // Готовый букет: в складе списываем сами цветы по расписанному составу,
    // а не «1 штуку» — иначе остатки в МоёмСкладе не сходятся.
    let parts = null, prod = null;
    try { prod = app.findRecordById("products", String(it.id)); } catch (_) {}
    if (prod && prod.get("is_express")) {
      // у варианта может быть свой состав (9 и 11 стеблей — разные букеты)
      const raw = shop.jget(prod, "variants");
      const vrow = (it.label && Array.isArray(raw)) ? raw.find((x) => x && x.label === it.label) : null;
      const v = (vrow && Array.isArray(vrow.parts) && vrow.parts.length) ? vrow.parts : shop.jget(prod, "ms_parts");
      if (Array.isArray(v) && v.length) parts = v.filter((x) => x && x.id && +x.qty > 0);
    }

    if (parts && parts.length) {
      const stemsTotal = parts.reduce((n, x) => n + (+x.qty || 0), 0) * it.qty;
      const perStem = Math.floor(Math.round(it.price * 100) * it.qty / Math.max(1, stemsTotal));
      parts.forEach((x) => {
        const q = (+x.qty || 0) * it.qty;
        positions.push({ quantity: q, price: perStem, assortment: meta("product", String(x.id)) });
        posKop += perStem * q;
      });
      continue;
    }

    // Микс: один товар на сайте — несколько сортов на складе. Храним доли,
    // а раскладываем по заказанному количеству: «7 пинк, 7 сноу, 11 блю» на 25
    // превращается в 4/4/7 на 15 и 14/14/23 на 51. Остаток отдаём тем, у кого
    // дробная часть больше — так сумма сходится ровно, без потерянных стеблей.
    const mix = prod ? shop.jget(prod, "ms_mix") : null;
    if (Array.isArray(mix) && mix.length) {
      const доли = mix.filter((x) => x && x.id && +x.share > 0);
      if (доли.length) {
        const st0 = stemsOf(it);
        const всего = st0.cnt * it.qty;
        const суммаДолей = доли.reduce((n, x) => n + (+x.share || 0), 0);
        const сырое = доли.map((x) => (+x.share || 0) * всего / суммаДолей);
        const целые = сырое.map((v) => Math.floor(v));
        let остаток = всего - целые.reduce((a, b) => a + b, 0);
        сырое.map((v, i) => ({ i, хвост: v - Math.floor(v) }))
          .sort((a, b) => b.хвост - a.хвост)
          .forEach((r) => { if (остаток > 0) { целые[r.i]++; остаток--; } });
        const заСтебель = Math.round(st0.price * 100);
        доли.forEach((x, i) => {
          if (!целые[i]) return;
          positions.push({ quantity: целые[i], price: заСтебель, assortment: meta("product", String(x.id)) });
          posKop += заСтебель * целые[i];
        });
        continue;
      }
    }

    const as = assortment(app, s, it);
    if (!as.ok) return as;
    const st = stemsOf(it);   // в МоёмСкладе номенклатура — стебель: количество стеблей и цена за стебель
    const qty = st.cnt * it.qty;
    const priceKop = Math.round(st.price * 100);
    positions.push({ quantity: qty, price: priceKop, assortment: meta("product", as.id) });
    posKop += priceKop * qty;
  }
  const delivery = o.get("delivery_price") || 0;
  if (delivery > 0) {
    const svc = deliveryService(app, s);
    // Молчать тут нельзя: без этой строки заказ в складе дешевле, чем заплатил
    // покупатель, и расхождение всплывает только при сверке кассы.
    if (!svc.id) {
      return { ok: false, wait: !!svc.rate,
        error: `Доставка ${delivery} ₽ не добавлена: ${svc.error || "не нашли услугу доставки в МоёмСкладе"}` };
    }
    // копейки, потерянные при делении цены букета на стебли, добавляем к доставке — итог сходится с сайтом
    const kop = Math.round(delivery * 100) + (itemsKop - posKop);
    positions.push({ quantity: 1, price: kop, assortment: meta("service", svc.id) });
  }
  return { ok: true, positions };
}

// Переписать позиции уже созданного заказа — после замены сорта.
// Сумма и количество не меняются, меняется только номенклатура.
function syncPositions(app, o) {
  const s = shop.settings(app);
  if (!o.get("ms_id")) return { ok: true };
  const pos = positionsFor(app, s, o);
  if (!pos.ok) return pos;
  return ms(s, "PUT", `/entity/customerorder/${o.get("ms_id")}`, { positions: pos.positions });
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

  const pos = positionsFor(app, s, o);
  if (!pos.ok) return pos;
  const positions = pos.positions;

  // сюда собираем поля, которые не удалось заполнить: молчать о них нельзя
  const missedAttrs = [];
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
attributes: buildAttributes(app, s, o, missedAttrs),
};
const ch = channelId(app, s);
if (ch) body.salesChannel = meta("saleschannel", ch);
// канал задан в настройках, а найти его не удалось — это молчать нельзя
else if (String(s.get("ms_channel") || "").trim()) missedAttrs.push(`Канал продаж = «${s.get("ms_channel")}»`);
const addr = addressFull(o);
if (addr) body.shipmentAddressFull = addr;
const paidNow = o.get("payment_status") === "paid";
const st = stateId(app, s, paidNow);
if (st) body.state = meta("state", st);
else {
  // без этапа МойСклад поставит свой первый — «Новый». Заказ всё равно отправляем
  // (потерять его хуже), но говорим об этом вслух, а не молчим.
  console.log("ms: этап не определён для заказа", o.get("number"));
  try {
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `⚠️ Заказ №${o.get("number")} ушёл в МойСклад без этапа — там он будет «Новый».\nПоставьте «Принят, ${paidNow ? "Оплачен" : "Не оплачен"}» вручную.` }));
  } catch (_) {}
}

  // Без доп. полей заказ в МоёмСкладе бесполезен: по ним там ведутся статусы.
  // Раньше он всё равно уезжал — пустым, и человек этого не видел. Теперь лучше
  // подождать: очередь повторит через минуту, когда склад отдышится.
  if (missedAttrs.indexOf("все доп. поля (склад не ответил)") >= 0) {
    console.log("ms: откладываю заказ", o.get("number"), "— склад не отдал список доп. полей");
    return { ok: false, wait: true, error: "МойСклад не отвечает — отправим через минуту." };
  }

  // Берём замок перед самой отправкой: до этого заказ мог не пройти проверки
  if (!claim(app, o.id, "push")) return { ok: false, wait: true, error: "Заказ уже отправляется в МойСклад." };
  const created = ms(s, "POST", "/entity/customerorder", body);
  if (!created.ok) { unclaim(app, o.id, "push"); return created; }
  // Заказ ушёл, но часть полей не заполнилась — чаще всего склад не ответил.
  // Раньше это проходило незаметно: у №3143 так пропал способ доставки.
  if (missedAttrs.length) {
    console.log("ms: не заполнены поля у заказа", o.get("number"), missedAttrs.join("; "));
    try {
      shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
        text: `⚠️ Заказ №${o.get("number")} ушёл в МойСклад, но не заполнились поля:\n${missedAttrs.join("\n")}\nПроставьте их вручную.` }));
    } catch (_) {}
  }
  o.set("ms_id", created.data.id);
  o.set("ms_error", "");
  app.save(o);
  // и запросом тоже: соседнее сохранение из копии, прочитанной раньше, затёрло бы
  // номер обратно в пустоту, и очередь отправила бы заказ в МойСклад второй раз
  try {
    app.db().newQuery("UPDATE orders SET ms_id = {:v} WHERE id = {:id}").bind({ v: created.data.id, id: o.id }).execute();
  } catch (err) { console.log("ms_id", err); require(`${__hooks}/lib/err.js`).note(app, "МойСклад", String(err), "запись номера заказа"); }
  return { ok: true, id: created.data.id };
}

// Входящий платёж в МоёмСкладе, привязанный к заказу покупателя
// Дозаполнить доп. поля у заказа, который уже лежит в МоёмСкладе.
// Нужно, когда поле не ушло при отправке: у №3128 так пропало «Время доставки»,
// и заказ не поехал по статусам. Заново создавать заказ нельзя — правим этот.
function updateAttrs(app, o) {
  if (!o.get("ms_id")) return { ok: false, error: "Заказ ещё не в МоёмСкладе." };
  const s = shop.settings(app);
  const missed = [];
  const attributes = buildAttributes(app, s, o, missed);
  const body = {
    attributes,
    deliveryPlannedMoment: `${o.get("date")} ${(o.get("interval") || "12:00").slice(0, 5)}:00`,
  };
  // Заодно пересобираем состав: у №3195 из-за того же сбоя потерялась строка
  // доставки, и в складе заказ оказался дешевле оплаченного.
  const pos = positionsFor(app, s, o);
  if (pos.ok) body.positions = pos.positions;
  else missed.push(pos.error || "состав заказа");

  const r = ms(s, "PUT", `/entity/customerorder/${o.get("ms_id")}`, body);
  if (!r.ok) return r;
  return { ok: true, filled: attributes.length, positions: pos.ok ? pos.positions.length : 0, missed };
}

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
  } catch (err) { console.log("ms_payment_id", err); require(`${__hooks}/lib/err.js`).note(app, "МойСклад", String(err), "запись платежа"); }
  return { ok: true, id: created.data.id };
}

// Перевести уже созданный заказ в «Принят, Оплачен»
function markPaid(app, o) {
  const s = shop.settings(app);
  if (!o.get("ms_id") || !s.get("ms_token")) return { ok: false };
  const st = stateId(app, s, true);
  if (!st) return { ok: false };
  return ms(s, "PUT", `/entity/customerorder/${o.get("ms_id")}`, { state: meta("state", st) });
}

module.exports = { stateName, stateId, ms, refs, pushOrder, updateAttrs, syncPositions, positionsFor, checkItem, channelId, msName, matchProduct, stemsOf, markPaid, addPayment, deliveryService };
