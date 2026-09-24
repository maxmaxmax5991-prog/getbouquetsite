// Адрес и расстояние: геокодер и подсказки Яндекса, стоимость доставки по километрам.
// Ключ Яндекса хранится в настройках и в браузер не уходит — сайт спрашивает наш сервер,
// а сервер уже ходит к Яндексу. Так ключ нельзя утащить со страницы.
const GEOCODE = "https://geocode-maps.yandex.ru/1.x/";
const SUGGEST = "https://suggest-maps.yandex.ru/v1/suggest";
const CITY = "Москва";

const enc = (v) => encodeURIComponent(String(v));

// Точность геокодера: до подъезда/дома — годится, до улицы и грубее — нет.
const EXACT = ["exact", "number", "near"];

function get(url) {
  try {
    const res = $http.send({ url, method: "GET", timeout: 20 });
    if (res.statusCode === 403) return { ok: false, error: "Ключ Яндекс.Карт не подошёл или исчерпан лимит." };
    if (res.statusCode >= 400) return { ok: false, error: `Карты ответили ошибкой ${res.statusCode}.` };
    if (!res.json) return { ok: false, error: "Карты ответили непонятно." };
    return { ok: true, data: res.json };
  } catch (err) {
    console.log("geo", err);
    return { ok: false, error: "Нет связи с картами." };
  }
}

// Подъезд, этаж, квартира, домофон — то, что картам неинтересно, а курьеру нужно.
function detailsLine(o) {
  const part = (label, v) => (v ? `, ${label} ${v}` : "");
  return [
    part("подъезд", o.entrance),
    part("этаж", o.floor),
    part("кв.", o.flat),
    o.intercom ? `, домофон ${o.intercom}` : "",
  ].join("");
}

// Строка адреса из частей заказа: то, что уходит курьеру и в МойСклад.
// Город подставляем только когда покупатель его не написал сам: в поле улицы можно
// указать и «Химки, Молодёжная улица» — возим не только внутри Москвы.
function addressLine(o) {
  const street = String(o.street || "").trim();
  const city = street.indexOf(",") >= 0 ? "" : `${CITY}, `;
  return [
    `${city}${street}`,
    o.house ? `, д. ${o.house}` : "",
    o.block ? `, к. ${o.block}` : "",
    detailsLine(o),
  ].join("").replace(/\s+/g, " ").trim();
}

// То, что отдаём картам: только улица, дом и корпус — квартира и этаж на координаты не влияют.
function geoQuery(o) {
  return `${o.street || ""} ${o.house || ""}${o.block ? " к" + o.block : ""}`.replace(/\s+/g, " ").trim();
}

function geocode(s, text) {
  const key = s.get("ymaps_key");
  if (!key) return { ok: false, error: "Не указан ключ Яндекс.Карт." };
  const r = get(`${GEOCODE}?apikey=${enc(key)}&format=json&results=1&lang=ru_RU&ll=37.6173,55.7558&spn=1.2,0.8&geocode=${enc(text)}`);
  if (!r.ok) return r;
  let m;
  try { m = r.data.response.GeoObjectCollection.featureMember; } catch (_) { m = null; }
  if (!m || !m.length) return { ok: false, error: "Такой адрес не найден. Проверьте улицу и дом." };
  const g = m[0].GeoObject;
  const pos = String(g.Point.pos || "").split(" ");           // «долгота широта»
  const lon = +pos[0], lat = +pos[1];
  if (!lat || !lon) return { ok: false, error: "Такой адрес не найден." };
  let precision = "";
  try { precision = g.metaDataProperty.GeocoderMetaData.precision || ""; } catch (_) {}
  let found = "";
  try { found = g.metaDataProperty.GeocoderMetaData.text || ""; } catch (_) {}
  return { ok: true, lat, lon, precision, exact: EXACT.indexOf(precision) >= 0, address: found };
}

// Подсказки при вводе улицы.
// У Яндекса это отдельный сервис (Геосаджест) со своим ключом; если он не заведён,
// пробуем ключом геокодера — иногда владелец берёт один ключ на оба.
function suggestKey(s) { return s.get("ymaps_suggest_key") || s.get("ymaps_key"); }

function suggest(s, q) {
  const key = suggestKey(s);
  if (!key || !q) return [];
  // город покупатель может назвать сам («Химки, Молодёжная»); если не назвал — ищем в Москве
  const text = q.indexOf(",") >= 0 ? q : `${CITY}, ${q}`;
  const r = get(`${SUGGEST}?apikey=${enc(key)}&text=${enc(text)}&lang=ru&results=7&types=street,house&ll=37.6173,55.7558&spn=1.2,0.8`);
  if (!r.ok || !r.data || !r.data.results) return [];
  return r.data.results.map((x) => ({
    title: (x.title && x.title.text) || "",
    subtitle: (x.subtitle && x.subtitle.text) || "",
    house: (x.tags || []).indexOf("house") >= 0,
  })).filter((x) => x.title);
}

// Расстояние без геокодера. Подсказки Яндекса возвращают, насколько найденный дом
// удалён от точки, которую мы им передали, — передаём координаты магазина и получаем
// готовые километры. Так хватает одного ключа (Геосаджест) вместо двух.
function distanceBySuggest(app, s, o) {
  const key = suggestKey(s);
  if (!key) return { ok: false, error: "Не указан ключ Яндекс.Карт." };
  const org = origin(app, s);
  if (!org.ok) return org;
  // Город покупатель может написать сам («Химки, Молодёжная улица»). Если не написал —
  // сначала ищем в Москве, иначе одинаковые названия улиц уводят в другие области.
  const q = geoQuery(o);
  const tries = String(o.street || "").indexOf(",") >= 0 ? [q] : [`${CITY}, ${q}`, q];
  let hit = null, r = null;
  for (let i = 0; i < tries.length && !hit; i++) {
    r = get(`${SUGGEST}?apikey=${enc(key)}&text=${enc(tries[i])}&lang=ru&results=1&types=house&print_address=1&ll=${org.lon},${org.lat}&spn=1.5,1.0`);
    if (!r.ok) return r;
    const first = ((r.data && r.data.results) || [])[0];
    if (first && first.distance) hit = first;
  }
  if (!hit) return { ok: false, error: "Такой адрес не найден. Проверьте улицу и дом." };
  const comp = (hit.address && hit.address.component) || [];
  const kind = (k) => (comp.find((c) => (c.kind || []).indexOf(k) >= 0) || {}).name || "";
  if (!kind("HOUSE")) return { ok: false, error: "Не нашли такой дом. Проверьте номер дома и корпус." };
  // за город не пускаем не по названию, а по кругам: докуда возим, задаёт самая большая зона
  const factor = +s.get("km_factor") > 0 ? +s.get("km_factor") : 1.3;
  const km = (hit.distance.value / 1000) * factor;
  return { ok: true, km: Math.round(km * 10) / 10, locality: kind("LOCALITY"), street: kind("STREET") };
}

// ---------- МКАД ----------
// Переводим градусы в километры на плоскости: для Москвы такой упрощённый способ
// ошибается на десятки метров, а считать им куда проще.
const KY = 110.574;
const KX = 111.320 * Math.cos(55.75 * Math.PI / 180);
const flat = (lat, lon) => [lon * KX, lat * KY];

function mkadPoly() {
  return require(`${__hooks}/lib/mkad.js`).MKAD.map((pt) => flat(pt[0], pt[1]));
}

// Точка внутри кольца? Считаем, сколько раз луч вправо пересечёт границу.
function insideMkad(lat, lon) {
  const poly = mkadPoly();
  const [x, y] = flat(lat, lon);
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Сколько километров от точки до кольца (по прямой, до ближайшего места МКАД)
function kmFromMkad(lat, lon) {
  const poly = mkadPoly();
  const [x, y] = flat(lat, lon);
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[j];
    const dx = bx - ax, dy = by - ay;
    const len = dx * dx + dy * dy;
    let t = len ? ((x - ax) * dx + (y - ay) * dy) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (d < best) best = d;
  }
  return Math.round(best * 10) / 10;
}

// Расстояние по прямой между двумя точками, километры

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Координаты адреса без геокодера. Подсказки Яндекса сообщают, насколько дом далёк
// от переданной точки; три замера из разных мест однозначно задают его координаты.
// Дороже на два запроса, зато не нужен отдельный ключ геокодера.
const TRI = [[37.20, 55.60], [38.05, 55.75], [37.60, 56.05]];

function locate(s, o) {
  const key = suggestKey(s);
  if (!key) return { ok: false, error: "Не указан ключ Яндекс.Карт." };
  const q = geoQuery(o);
  const text = q.indexOf(",") >= 0 ? q : `${CITY}, ${q}`;
  const ms = [];
  let address = "";
  for (let i = 0; i < TRI.length; i++) {
    const r = get(`${SUGGEST}?apikey=${enc(key)}&text=${enc(text)}&lang=ru&results=1&types=house&print_address=1&ll=${TRI[i][0]},${TRI[i][1]}&spn=2.5,1.6`);
    if (!r.ok) return r;
    const hit = ((r.data && r.data.results) || [])[0];
    if (!hit || !hit.distance) return { ok: false, error: "Такой адрес не найден. Проверьте улицу и дом." };
    const comp = (hit.address && hit.address.component) || [];
    const kind = (k) => (comp.find((c) => (c.kind || []).indexOf(k) >= 0) || {}).name || "";
    if (!kind("HOUSE")) return { ok: false, error: "Не нашли такой дом. Проверьте номер дома и корпус." };
    // все три замера должны говорить об одной улице, иначе точку считать нельзя
    const where = `${kind("LOCALITY")}|${kind("STREET")}`;
    if (i === 0) { address = where; ms.push(where); }
    else if (where !== ms[0]) return { ok: false, error: "Не смогли найти этот адрес на карте. Проверьте улицу и дом." };
    ms.push([TRI[i][0], TRI[i][1], hit.distance.value / 1000]);
  }

  // пересечение трёх окружностей: вычитаем первое уравнение из остальных
  const pts = ms.filter((x) => Array.isArray(x)).map(([lon, lat, d]) => [(lon - 37.62) * KX, (lat - 55.75) * KY, d]);
  const [x1, y1, d1] = pts[0];
  const rows = pts.slice(1).map(([x, y, d]) => [2 * (x - x1), 2 * (y - y1), d1 * d1 - d * d + x * x - x1 * x1 + y * y - y1 * y1]);
  const det = rows[0][0] * rows[1][1] - rows[0][1] * rows[1][0];
  if (!det) return { ok: false, error: "Не смогли определить адрес на карте." };
  const x = (rows[0][2] * rows[1][1] - rows[0][1] * rows[1][2]) / det;
  const y = (rows[0][0] * rows[1][2] - rows[0][2] * rows[1][0]) / det;
  const [locality, street] = address.split("|");
  return { ok: true, lat: 55.75 + y / KY, lon: 37.62 + x / KX, locality, street };
}

// Координаты торговой точки. Считаем один раз и запоминаем в настройках,

// чтобы не дёргать геокодер на каждый заказ.
function origin(app, s) {
  const lat = +s.get("origin_lat"), lon = +s.get("origin_lon");
  if (lat && lon) return { ok: true, lat, lon };
  const addr = s.get("origin_address") || `${CITY}, Маленковская улица, 14к1`;
  if (!s.get("ymaps_key")) return { ok: false, error: "Не заданы координаты магазина. Впишите их в админке: Доставка → «Координаты магазина»." };
  const g = geocode(s, addr);
  if (!g.ok) return g;
  s.set("origin_lat", g.lat);
  s.set("origin_lon", g.lon);
  try { app.save(s); } catch (err) { console.log("origin save", err); }
  return { ok: true, lat: g.lat, lon: g.lon };
}

// Километры от точки до адреса с поправкой на то, что улицы не прямые
function distance(app, s, lat, lon) {
  const o = origin(app, s);
  if (!o.ok) return o;
  const factor = +s.get("km_factor") > 0 ? +s.get("km_factor") : 1.3;
  const km = haversine(o.lat, o.lon, lat, lon) * factor;
  return { ok: true, km: Math.round(km * 10) / 10 };
}

// Зоны-круги от магазина: берём ближайший круг, в который попал адрес.
// Зоны без радиуса в расчёте не участвуют — иначе можно случайно отдать доставку даром.
function zonesByRadius(app) {
  return app.findRecordsByFilter("delivery_zones", "active = true", "sort", 100, 0)
    .filter((z) => +z.get("radius_km") > 0)
    .sort((a, b) => +a.get("radius_km") - +b.get("radius_km"));
}

// Стоимость доставки от МКАД: внутри кольца одна цена, за кольцом — плюс за километр.
function priceFromMkad(s, pos) {
  const base = +s.get("mkad_price") || 0;
  if (insideMkad(pos.lat, pos.lon)) return { ok: true, price: base, zone: "", zoneName: "внутри МКАД", out_km: 0 };
  const out = kmFromMkad(pos.lat, pos.lon);
  const max = +s.get("mkad_max_km") || 0;
  if (max > 0 && out > max) return { ok: false, error: `Пока не возим дальше ${max} км от МКАД. Позвоните нам — договоримся.` };
  const perKm = +s.get("mkad_km_price") || 0;
  return { ok: true, price: base + Math.ceil(out) * perKm, zone: "", zoneName: `${out} км за МКАД`, out_km: out };
}

// Стоимость доставки по расстоянию: цена зоны, в чей круг попал адрес.
function priceFor(app, s, km, sum) {
  const zones = zonesByRadius(app);
  if (!zones.length) return { ok: false, error: "Зоны доставки не настроены. Позвоните нам — оформим вручную." };
  const z = zones.find((x) => km <= +x.get("radius_km"));
  if (!z) {
    const max = +zones[zones.length - 1].get("radius_km");
    return { ok: false, error: `Пока не возим дальше ${max} км от магазина. Позвоните нам — договоримся.` };
  }
  const free = +z.get("free_from") || 0;
  const price = (free > 0 && sum >= free) ? 0 : (+z.get("price") || 0);
  return { ok: true, price, zone: z.id, zoneName: z.get("name") || "" };
}

// Полная проверка адреса: координаты, расстояние, цена. Одно место и для сайта, и для заказа.
function check(app, s, o, sum) {
  if (!o.street) return { ok: false, error: "Укажите улицу." };
  if (!o.house) return { ok: false, error: "Укажите дом." };

  // Сначала геокодер: он точнее и даёт координаты для курьера. Нет ключа или он не
  // подошёл — работаем по подсказкам. Для расчёта от МКАД нужны координаты (три замера),
  // для кругов от магазина хватает одного замера расстояния.
  let lat = 0, lon = 0, km = 0, locality = "", street = "";
  const g = s.get("ymaps_key") ? geocode(s, geoQuery(o)) : { ok: false, error: "" };
  if (g.ok && g.exact) {
    const d = distance(app, s, g.lat, g.lon);
    if (!d.ok) return d;
    lat = g.lat; lon = g.lon; km = d.km;
  } else if (s.get("mkad_mode")) {
    const loc = locate(s, o);
    if (!loc.ok) return loc;
    lat = loc.lat; lon = loc.lon; locality = loc.locality; street = loc.street;
    const d = distance(app, s, lat, lon);
    km = d.ok ? d.km : 0;
  } else {
    const sg = distanceBySuggest(app, s, o);
    if (!sg.ok) return sg;
    km = sg.km; locality = sg.locality; street = sg.street;
  }

  const p = s.get("mkad_mode") ? priceFromMkad(s, { lat, lon }) : priceFor(app, s, km, +sum || 0);
  if (!p.ok) return p;
  // Город и улицу берём у карт (они знают правильное написание), а дом — тот, что вписал
  // покупатель: карты на «12» иногда отвечают «12с17», и курьер уехал бы не в то строение.
  const base = (locality || street)
    ? `${locality || CITY}, ${street || o.street}${o.house ? `, д. ${o.house}` : ""}${o.block ? `, к. ${o.block}` : ""}`
    : addressLine({ street: o.street, house: o.house, block: o.block });
  return { ok: true, lat, lon, km, out_km: p.out_km || 0, price: p.price, zone: p.zone, zoneName: p.zoneName,
    address: `${base}${detailsLine(o)}`, found: base };
}

module.exports = { geocode, suggest, distanceBySuggest, detailsLine, locate, insideMkad, kmFromMkad, priceFromMkad, distance, priceFor, zonesByRadius, check, addressLine, geoQuery, haversine, origin };
