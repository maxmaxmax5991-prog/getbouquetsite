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

// Строка адреса из частей заказа: то, что уходит курьеру и в МойСклад.
function addressLine(o) {
  const part = (label, v) => (v ? `, ${label} ${v}` : "");
  return [
    `${CITY}, ${o.street || ""}`,
    o.house ? `, д. ${o.house}` : "",
    part("к.", o.block),
    part("подъезд", o.entrance),
    part("этаж", o.floor),
    part("кв.", o.flat),
    o.intercom ? `, домофон ${o.intercom}` : "",
  ].join("").replace(/\s+/g, " ").trim();
}

// То, что отдаём геокодеру: только улица, дом и корпус — квартира и этаж на координаты не влияют.
function geoQuery(o) {
  return `${CITY}, ${o.street || ""} ${o.house || ""}${o.block ? " к" + o.block : ""}`.replace(/\s+/g, " ").trim();
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
function suggest(s, q) {
  const key = s.get("ymaps_suggest_key") || s.get("ymaps_key");
  if (!key || !q) return [];
  const r = get(`${SUGGEST}?apikey=${enc(key)}&text=${enc(CITY + ", " + q)}&lang=ru&results=7&types=street,house&ll=37.6173,55.7558&spn=1.2,0.8`);
  if (!r.ok || !r.data || !r.data.results) return [];
  return r.data.results.map((x) => ({
    title: (x.title && x.title.text) || "",
    subtitle: (x.subtitle && x.subtitle.text) || "",
  })).filter((x) => x.title);
}

// Расстояние по прямой между двумя точками, километры
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// Координаты торговой точки. Считаем один раз и запоминаем в настройках,
// чтобы не дёргать геокодер на каждый заказ.
function origin(app, s) {
  const lat = +s.get("origin_lat"), lon = +s.get("origin_lon");
  if (lat && lon) return { ok: true, lat, lon };
  const addr = s.get("origin_address") || `${CITY}, Маленковская улица, 14к1`;
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
  const g = geocode(s, geoQuery(o));
  if (!g.ok) return g;
  if (!g.exact) return { ok: false, error: "Не нашли такой дом. Проверьте номер дома и корпус." };
  const d = distance(app, s, g.lat, g.lon);
  if (!d.ok) return d;
  const p = priceFor(app, s, d.km, +sum || 0);
  if (!p.ok) return p;
  return { ok: true, lat: g.lat, lon: g.lon, km: d.km, price: p.price, zone: p.zone, zoneName: p.zoneName,
    address: addressLine(o), found: g.address };
}

module.exports = { geocode, suggest, distance, priceFor, zonesByRadius, check, addressLine, geoQuery, haversine, origin };
