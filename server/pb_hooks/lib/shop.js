// Общие функции магазина. Подключается через require() внутри обработчиков:
// обработчики PocketBase выполняются изолированно и не видят код верхнего уровня файлов.

const STATUS = {
  new: "Новый", confirmed: "Подтверждён", assembling: "Собирается", photo: "Фото отправлено",
  delivering: "В пути", done: "Доставлен", cancelled: "Отменён",
};
const COUNTS = [25, 51, 101];

const rub = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
// JSON-поля записи: читаем как строку и разбираем (напрямую приходят байтами)
const jget = (rec, name) => { try { const s = rec.getString(name); return s ? JSON.parse(s) : null; } catch (_) { return null; } };

function settings(app) {
  return app.findFirstRecordByFilter("settings", "id != ''");
}

function fileUrl(rec, name, thumb) {
  if (!name) return "";
  return `/api/files/${rec.collection().name}/${rec.id}/${name}` + (thumb ? `?thumb=${thumb}` : "");
}

const labelText = (l) => /^\d+-\d+$/.test(l) ? `${l.split("-")[1]} шт · ${l.split("-")[0]} см` : /^\d+$/.test(l) ? `${l} шт` : `размер ${l}`;

// Кнопки размеров «по умолчанию» для букета с одной известной ценой (помечаются estimated).
// Число цветов в названии — считаем от цены за стебель со скидкой за объём (стебель в 101 примерно на 25% дешевле, чем в 25);
// иначе — размеры S/M/L.
function estimateVariants(name, price) {
  const round = (x) => Math.max(10, Math.round(x / 100) * 100 - 10);
  const m = String(name).match(/^(\d+)\s/);
  if (m) {
    const n = +m[1], per = price / n;
    let sizes = [9, 15, 25, 51, 101].filter((k) => k !== n && k >= n / 3 && k <= n * 2.2);
    sizes = sizes.concat([n]).sort((a, b) => a - b);
    while (sizes.length > 5) sizes.splice(sizes[0] === n ? sizes.length - 1 : 0, 1);
    return sizes.map((k) => k === n
      ? { label: String(k), price }
      : { label: String(k), price: round(per * k * Math.pow(k / n, -0.2)), estimated: true });
  }
  return [
    { label: "S", price: round(price * 0.75), estimated: true },
    { label: "M", price },
    { label: "L", price: round(price * 1.45), estimated: true },
  ];
}

// Итоговые варианты товара: для одноголовых роз — из прайса «длина × количество», иначе — сохранённые
function variantsOf(p, s) {
  const lengths = jget(p, "lengths");
  if (Array.isArray(lengths) && lengths.length) {
    const prices = jget(s, "rose_prices") || {};
    const out = [];
    lengths.forEach((L) => COUNTS.forEach((C) => {
      const price = prices[L] && prices[L][C];
      if (price) out.push({ label: `${L}-${C}`, price: +price, len: +L, cnt: C });
    }));
    return out;
  }
  const v = jget(p, "variants");
  return Array.isArray(v) ? v.filter((x) => x && x.label && +x.price > 0) : [];
}

function catalog(app) {
  const s = settings(app);
  const cats = app.findRecordsByFilter("categories", "active = true", "sort", 100, 0);
  const catById = {};
  cats.forEach((c) => catById[c.id] = c);
  const products = app.findRecordsByFilter("products", "active = true", "sort,-created", 1000, 0)
    .filter((p) => catById[p.get("category")])
    .map((p) => {
      const photos = p.get("photo") || [];
      const variants = variantsOf(p, s).map((v) => Object.assign({}, v, v.photo ? { img: fileUrl(p, v.photo, "560x0") } : {}));
      const lengths = jget(p, "lengths");
      const cut = p.get("cutout");
      return {
        id: p.id,
        name: p.get("name"),
        cat: catById[p.get("category")].get("slug"),
        price: variants.length ? Math.min.apply(null, variants.map((v) => v.price)) : p.get("price"),
        bonus: p.get("bonus") || 0,
        img: photos.length ? fileUrl(p, photos[0], "560x0") : "",
        big: photos.length ? fileUrl(p, photos[0]) : "",
        variants: variants.length ? variants : undefined,
        lengths: Array.isArray(lengths) && lengths.length ? lengths : undefined,
        sale: p.get("badge") === "sale" ? 1 : undefined,
        author: p.get("badge") === "author" ? 1 : undefined,
        hit: p.get("badge") === "hit" ? 1 : undefined,
        popular: p.get("popular") || undefined,
        featured: p.get("featured") && cut ? { cut: fileUrl(p, cut), mood: p.get("mood") || "", tint: p.get("tint") || "#E0178A" } : undefined,
        description: p.get("description") || undefined,
      };
    });
  const zones = app.findRecordsByFilter("delivery_zones", "active = true", "sort", 100, 0)
    .map((z) => ({ id: z.id, name: z.get("name"), price: z.get("price"), free_from: z.get("free_from") }));
  const intervals = app.findRecordsByFilter("delivery_intervals", "active = true", "sort,start", 100, 0)
    .map((i) => ({ label: `${i.get("start")}–${i.get("end")}`, start: i.get("start"), extra: i.get("extra") || 0 }));
  return {
    categories: cats.map((c) => ({ slug: c.get("slug"), name: c.get("name"), addon: c.get("addon") })),
    products,
    rose_prices: jget(s, "rose_prices") || {},
    delivery: {
      zones, intervals,
      min_order: s.get("min_order") || 0,
      lead_hours: s.get("lead_hours") || 0,
      days_ahead: s.get("days_ahead") || 14,
      closed_dates: jget(s, "closed_dates") || [],
      accepting: s.get("accepting"),
    },
    phone: s.get("phone") || "",
    notice: s.get("notice") || "",
  };
}

// ---------- Заказ: всё пересчитываем на сервере, клиенту не доверяем ----------
function moscowNow() {
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":"); return (+h) * 60 + (+m); };

function prepareOrder(app, rec) {
  const s = settings(app);
  const fail = (msg) => { throw new BadRequestError(msg); };
  if (!s.get("accepting")) fail("Сейчас мы не принимаем заказы. Позвоните нам, пожалуйста.");

  const raw = jget(rec, "items");
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) fail("Корзина пуста.");
  const items = [];
  let sum = 0, bonus = 0;
  raw.forEach((it) => {
    let p;
    try { p = app.findRecordById("products", String(it.id)); } catch (_) { fail("Один из букетов больше недоступен. Обновите страницу."); }
    if (!p.get("active")) fail(`«${p.get("name")}» сейчас недоступен.`);
    const qty = Math.floor(+it.qty);
    if (!(qty >= 1 && qty <= 99)) fail("Неверное количество.");
    const variants = variantsOf(p, s);
    let price = p.get("price"), label = "";
    if (variants.length) {
      const v = variants.find((x) => x.label === String(it.label || ""));
      if (!v) fail(`Выберите размер для «${p.get("name")}».`);
      price = v.price; label = v.label;
    }
    items.push({ id: p.id, name: p.get("name"), label, label_text: label ? labelText(label) : "", price, qty, sum: price * qty });
    sum += price * qty;
    bonus += (p.get("bonus") || 0) * qty;
  });
  if (sum < (s.get("min_order") || 0)) fail(`Минимальная сумма заказа — ${rub(s.get("min_order"))}.`);

  let delivery = 0;
  const zoneId = rec.get("zone");
  if (zoneId) {
    let z;
    try { z = app.findRecordById("delivery_zones", zoneId); } catch (_) { fail("Выберите зону доставки."); }
    if (!z.get("active")) fail("Выберите зону доставки.");
    delivery = (z.get("free_from") > 0 && sum >= z.get("free_from")) ? 0 : (z.get("price") || 0);
  } else if (app.findRecordsByFilter("delivery_zones", "active = true", "", 1, 0).length) {
    fail("Выберите зону доставки.");
  }

  const date = String(rec.get("date"));
  const now = moscowNow();
  const closed = jget(s, "closed_dates") || [];
  if (date < now.date) fail("Эта дата уже прошла.");
  if (date > addDays(now.date, s.get("days_ahead") || 14)) fail("Выберите более близкую дату.");
  if (closed.indexOf(date) >= 0) fail("В этот день мы не доставляем. Выберите другую дату.");

  const interval = String(rec.get("interval") || "");
  const ints = app.findRecordsByFilter("delivery_intervals", "active = true", "sort", 100, 0);
  if (ints.length) {
    const found = ints.find((i) => `${i.get("start")}–${i.get("end")}` === interval);
    if (!found) fail("Выберите интервал доставки.");
    if (date === now.date && toMin(found.get("start")) - (s.get("lead_hours") || 0) * 60 < now.minutes) {
      fail("На этот интервал уже не успеем. Выберите более поздний.");
    }
    delivery += found.get("extra") || 0;
  }

  const last = app.findRecordsByFilter("orders", "number > 0", "-number", 1, 0);
  rec.set("number", last.length ? last[0].get("number") + 1 : 1001);
  rec.set("status", "new");
  rec.set("items", items);
  rec.set("items_sum", sum);
  rec.set("delivery_price", delivery);
  rec.set("total", sum + delivery);
  rec.set("bonus", bonus);
  rec.set("comment", "");
}

// ---------- Телеграм ----------
function tg(token, method, payload) {
  if (!token) return null;
  try {
    const res = $http.send({
      url: `https://api.telegram.org/bot${token}/${method}`,
      method: "POST",
      body: JSON.stringify(payload || {}),
      headers: { "content-type": "application/json" },
      timeout: 20,
    });
    if (res.statusCode !== 200) console.log("telegram", method, res.statusCode, toString(res.body));
    return res.json;
  } catch (err) {
    console.log("telegram error", method, err);
    return null;
  }
}

function adminIds(s) {
  return String(s.get("tg_admins") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

function orderText(o) {
  const items = (jget(o, "items") || []).map((it) => `• ${it.name}${it.label_text ? " · " + it.label_text : ""} × ${it.qty} — ${rub(it.sum)}`).join("\n");
  return [
    `🧾 Заказ №${o.get("number")} — ${STATUS[o.get("status")] || o.get("status")}`,
    "",
    items,
    `Доставка: ${rub(o.get("delivery_price") || 0)}`,
    `Итого: ${rub(o.get("total") || 0)}`,
    "",
    `📅 ${o.get("date")}, ${o.get("interval") || "—"}`,
    `📍 ${o.get("address")}`,
    `👤 ${o.get("name")}, ${o.get("phone")}`,
    o.get("recipient") ? `🎁 Получатель: ${o.get("recipient")}` : "",
    o.get("note") ? `💌 Открытка: ${o.get("note")}` : "",
  ].filter((x) => x !== "").join("\n");
}

function orderKeyboard(o) {
  const next = [["confirmed", "Подтвердить"], ["assembling", "Собирается"], ["photo", "Фото отправлено"],
    ["delivering", "В пути"], ["done", "Доставлен"], ["cancelled", "Отменить"]];
  const rows = [];
  for (let i = 0; i < next.length; i += 2) {
    rows.push(next.slice(i, i + 2).map(([st, t]) => ({ text: (o.get("status") === st ? "● " : "") + t, callback_data: `o:${o.id}:${st}` })));
  }
  return { inline_keyboard: rows };
}

function notifyOrder(app, o) {
  const s = settings(app);
  const token = s.get("tg_token");
  adminIds(s).forEach((chat) => tg(token, "sendMessage", { chat_id: chat, text: orderText(o), reply_markup: orderKeyboard(o) }));
}

module.exports = {
  STATUS, COUNTS, rub, jget, settings, fileUrl, labelText, estimateVariants, variantsOf, catalog, prepareOrder,
  tg, adminIds, orderText, orderKeyboard, notifyOrder,
};
