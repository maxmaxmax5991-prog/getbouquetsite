// Общие функции магазина. Подключается через require() внутри обработчиков:
// обработчики PocketBase выполняются изолированно и не видят код верхнего уровня файлов.

const STATUS = {
  new: "Новый", confirmed: "Подтверждён", assembling: "Собирается", photo: "Букет собран",
  delivering: "В пути", done: "Доставлен", cancelled: "Отменён",
};
const COUNTS = [25, 51, 101];   // если прайс не настроен

const rub = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
// JSON-поля записи: читаем как строку и разбираем (напрямую приходят байтами)
const jget = (rec, name) => { try { const s = rec.getString(name); return s ? JSON.parse(s) : null; } catch (_) { return null; } };

// Роль вошедшего сотрудника: owner (владелец), head (управляющий), manager (менеджер).
// Нет роли — считаем менеджером: меньше прав, чем нужно, безопаснее, чем больше.
function role(e) {
  try { return String(e.auth.get("role") || "manager"); } catch (_) { return "manager"; }
}
const can = (e, roles) => roles.indexOf(role(e)) >= 0;

// Замок на действие с заказом: вставка второй такой строки не проходит,
// поэтому два одновременных запроса не сделают одно и то же дважды.
// Замок старше 15 минут считаем брошенным — значит, сервер перезапустился посреди дела.
function claim(app, id, kind) {
  try {
    app.db().newQuery("DELETE FROM order_locks WHERE order_id = {:id} AND kind = {:k} AND at < {:old}")
      .bind({ id, k: kind, old: new Date(Date.now() - 15 * 60000).toISOString() }).execute();
    app.db().newQuery("INSERT INTO order_locks (order_id, kind, at) VALUES ({:id}, {:k}, {:t})")
      .bind({ id, k: kind, t: new Date().toISOString() }).execute();
    return true;
  } catch (_) { return false; }
}
function unclaim(app, id, kind) {
  try { app.db().newQuery("DELETE FROM order_locks WHERE order_id = {:id} AND kind = {:k}").bind({ id, k: kind }).execute(); } catch (_) {}
}

const moscowToday = () => moscowNow().date;

function settings(app) {
  return app.findFirstRecordByFilter("settings", "id != ''");
}

function fileUrl(rec, name, thumb) {
  if (!name) return "";
  return `/api/files/${rec.collection().name}/${rec.id}/${name}` + (thumb ? `?thumb=${thumb}` : "");
}

// «2026-09-24» → «24 сентября»
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
function dateRu(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || "");
  return `${+m[3]} ${MONTHS[+m[2] - 1]}`;
}
const whenText = (o) => `${dateRu(o.get("date"))}${o.get("interval") ? ", " + o.get("interval") : ""}`;

// длина 0 — значит длины у товара нет (гортензии и прочее не по стеблю)
const labelText = (l) => /^\d+-\d+$/.test(l)
  ? (l.split("-")[0] === "0" ? `${l.split("-")[1]} шт` : `${l.split("-")[1]} шт · ${l.split("-")[0]} см`)
  : /^\d+$/.test(l) ? `${l} шт` : `размер ${l}`;

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

// Прайсы «длина × количество»: отдельно для одноголовых, кустовых и т.д.
function priceTables(s) {
  const t = jget(s, "price_tables");
  if (Array.isArray(t) && t.length) return t;
  return [{ id: "single", name: "Одноголовые розы", counts: COUNTS, prices: jget(s, "rose_prices") || {} }];
}

// Итоговые варианты товара: по прайсу (если заданы длины) или сохранённые размеры
// Остаток стеблей по длинам: {"40": 360}. Нет ключа — учёта нет, продаём свободно.
function stockOf(p) {
  const v = jget(p, "stock");
  return (v && typeof v === "object") ? v : {};
}
// Хватает ли стеблей на такой размер (длина-количество)
function stockOk(p, len, cnt) {
  const st = stockOf(p);
  const have = st[String(len)];
  return have === undefined || have === null || +have >= +cnt;
}

function variantsOf(p, s) {
  const lengths = jget(p, "lengths");
  if (Array.isArray(lengths) && lengths.length) {
    const tables = priceTables(s);
    const t = tables.find((x) => x.id === p.get("price_table")) || tables[0];
    const counts = Array.isArray(t.counts) && t.counts.length ? t.counts : COUNTS;
    const prices = t.prices || {};
    const out = [];
    // Размер, на который не хватает стеблей, не убираем — показываем блёклым
    // с подписью «закончились». Так видно, что сорт есть, просто кончился.
    lengths.forEach((L) => counts.forEach((C) => {
      const price = prices[L] && prices[L][C];
      if (price) out.push({ label: `${L}-${C}`, price: +price, len: +L, cnt: C, out: stockOk(p, L, C) ? undefined : true });
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
      // сколько цветов на самом снимке — подпись поверх фото берётся отсюда, а не из выбранного размера
      const counts = jget(p, "photo_counts") || {};
      const cntOf = (name) => (name && +counts[name] > 0 ? +counts[name] : undefined);
      const variants = variantsOf(p, s).map((v) => Object.assign({}, v,
        v.photo ? { img: fileUrl(p, v.photo, "560x0"), big: fileUrl(p, v.photo, "1080x0"), cnt: cntOf(v.photo) } : {}));
      const lengths = jget(p, "lengths");
      const cut = p.get("cutout");
      // какой размер показывать сразу: задаётся в прайсе («по умолчанию»)
      const table = priceTables(s).find((x) => x.id === p.get("price_table"));
      const defCnt = table && +table.def_count > 0 ? +table.def_count : 0;
      const defVar = (defCnt ? variants.find((v) => v.cnt === defCnt && !v.out) : null) || variants.find((v) => !v.out) || null;
      return {
        id: p.id,
        name: p.get("name"),
        cat: catById[p.get("category")].get("slug"),
        price: variants.length ? Math.min.apply(null, (variants.filter((v) => !v.out).length ? variants.filter((v) => !v.out) : variants).map((v) => v.price)) : p.get("price"),
        // всё закончилось — карточка гаснет и купить нельзя
        soldout: variants.length && variants.every((v) => v.out) ? true : undefined,
        // товар без цены (пустое поле в карточке) нельзя купить — сайт покажет его без кнопки
        no_price: variants.length ? undefined : (+p.get("price") > 0 ? undefined : true),
        bonus: p.get("bonus") || 0,
        img: photos.length ? fileUrl(p, photos[0], "560x0") : "",
        // на странице товара снимок во всю ширину — там нужен размер побольше, чем на карточке
        big: photos.length ? fileUrl(p, photos[0], "1080x0") : "",
        // все снимки товара: на странице товара их можно листать
        photos: photos.length > 1 ? photos.map((f) => ({
          img: fileUrl(p, f, "560x0"), big: fileUrl(p, f, "1080x0"), thumb: fileUrl(p, f, "160x160"), cnt: cntOf(f),
        })) : undefined,
        cnt: photos.length ? cntOf(photos[0]) : undefined,
        variants: variants.length ? variants : undefined,
        def_label: defVar ? defVar.label : undefined,
        site_only: p.get("site_only") ? true : undefined,
        badge_text: String(p.get("badge_text") || "").trim() || undefined,
        // «сегодня с теплицы» — только в день завоза, назавтра само пропадёт
        fresh: String(p.get("fresh_date") || "") === moscowNow().date ? true : undefined,
        // «цветы ещё в пути»: сайт покажет предупреждение и не даст ранний интервал
        ready_at: (function () {
          const v = String(p.get("ready_at") || "").trim();
          if (!v) return undefined;
          const now = moscowNow();
          const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
          if (!m) return undefined;
          if (m[1] < now.date || (m[1] === now.date && +m[2] * 60 + +m[3] <= now.minutes)) return undefined;
          return `${m[1]} ${m[2].padStart(2, "0")}:${m[3]}`;
        })(),
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
    .map((z) => ({ id: z.id, name: z.get("name"), price: z.get("price"), free_from: z.get("free_from"), radius_km: +z.get("radius_km") || 0 }));
  return {
    categories: cats.map((c) => ({ slug: c.get("slug"), name: c.get("name"), addon: c.get("addon") })),
    products,
    price_tables: priceTables(s),
    delivery: {
      // когда доставку считает карта (круги или МКАД), покупатель зону не выбирает
      zones: autoDelivery(s) ? [] : zones,
      km: autoDelivery(s)
        ? { on: true, from: s.get("origin_address") || "", mkad: !!s.get("mkad_mode"),
            rings: s.get("mkad_mode") ? [] : zones.filter((z) => z.radius_km > 0).sort((a, b) => a.radius_km - b.radius_km) }
        : null,
      slots: slotRules(s),
      min_order: s.get("min_order") || 0,
      lead_hours: s.get("lead_hours") || 0,
      days_ahead: s.get("days_ahead") || 14,
      closed_dates: jget(s, "closed_dates") || [],
      accepting: s.get("accepting"),
    },
    pickup: s.get("pickup") ? { address: s.get("pickup_address") || "", hours: s.get("pickup_hours") || "" } : null,
    payment: {
      card: !!(s.get("pay_card") && s.get("cp_public_id")),
      on_delivery: !!(s.get("pay_on_delivery") && s.get("pickup")),   // при получении — только самовывоз
      public_id: s.get("pay_card") ? (s.get("cp_public_id") || "") : "",
    },
    suggest: !!(s.get("ymaps_suggest_key") || s.get("ymaps_key")),   // подсказывать ли улицы при вводе
    bot: s.get("tg_client_bot") || s.get("tg_bot") || "",
    maxBot: s.get("max_token") ? (s.get("max_bot") || "") : "",
    phone: s.get("phone") || "",
    notice: s.get("notice") || "",
  };
}

// ---------- Интервалы доставки ----------
// Считаются от времени заказа: сначала сборка букета (дорогой собирают дольше),
// потом трёхчасовое окно. Начало всегда кратно получасу — так понятнее покупателю.
// Самый поздний «цветы будут у нас» среди товаров заказа. Пустое — всё на месте.
// Прошедшее время не считаем: роза уже приехала.
function readyOf(app, items) {
  const now = moscowNow();
  let best = null;
  (items || []).forEach((it) => {
    let p = null;
    try { p = app.findRecordById("products", String(it.id || "")); } catch (_) {}
    const v = p && String(p.get("ready_at") || "").trim();
    if (!v) return;
    const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
    if (!m) return;
    const cur = { date: m[1], minutes: +m[2] * 60 + +m[3] };
    if (cur.date < now.date || (cur.date === now.date && cur.minutes <= now.minutes)) return;
    if (!best || cur.date > best.date || (cur.date === best.date && cur.minutes > best.minutes)) best = cur;
  });
  return best;
}

function slotRules(s) {
  return {
    from: String(s.get("work_from") || "09:00"),
    to: String(s.get("work_to") || "21:00"),
    till: String(s.get("delivery_to") || s.get("work_to") || "23:00"),
    prep: +s.get("prep_min") || 45,
    prep_big: +s.get("prep_min_big") || 65,
    big_from: +s.get("prep_big_from") || 0,
    hours: +s.get("slot_hours") || 3,
    step: +s.get("slot_step") || 30,
    min: +s.get("slot_min") || 60,
  };
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Сколько минут собираем букет на такую сумму
function prepFor(r, sum) {
  return (r.big_from > 0 && sum > r.big_from) ? r.prep_big : r.prep;
}

// Все интервалы, которые ещё можно выбрать на эту дату.
// graceMin — небольшая поблажка при проверке заказа: пока покупатель заполнял форму,
// время ушло вперёд, и выбранный интервал не должен из-за этого «протухнуть».
function slotsFor(s, dateIso, sum, graceMin, pickup, ready) {
  const r = slotRules(s);
  const open = toMin(r.from), send = toMin(r.to);
  // забрать самому можно только до конца рабочего дня; позже едут одни курьеры
  const till = pickup ? send : Math.max(toMin(r.till), send);
  const now = moscowNow();
  let first = open;
  if (dateIso === now.date) first = Math.max(open, now.minutes + prepFor(r, sum) - (graceMin || 0));
  else if (dateIso < now.date) return [];
  // цветы ещё едут: собирать начнём не раньше, чем они приедут
  if (ready) {
    if (dateIso < ready.date) return [];
    if (dateIso === ready.date) first = Math.max(first, ready.minutes + prepFor(r, sum) - (graceMin || 0));
  }
  const start0 = Math.ceil(first / r.step) * r.step;
  // самовывоз: окно короткое, в размер шага — забрать можно сразу, как собрали
  const full = pickup ? r.step : r.hours * 60;
  // букет должен уехать не позже «отправляем до», а приехать не позже «крайнего времени доставки»
  const last = Math.min(send, till - full);
  const out = [];
  for (let t = start0; t <= last; t += r.step) out.push(`${hhmm(t)}–${hhmm(t + full)}`);
  // целое окно уже не помещается — предлагаем последнее покороче, иначе поздним
  // вечером заказ на сегодня оформить нельзя вовсе
  if (!out.length && start0 <= send && start0 + Math.min(full, r.min) <= till) out.push(`${hhmm(start0)}–${hhmm(till)}`);
  return out;
}

// Что не так с выбранным интервалом: пустая строка — всё в порядке.
function slotProblem(s, dateIso, sum, label, pickup, ready) {
  const r = slotRules(s);
  const m = String(label).match(/^(\d{1,2}):(\d{2})[–-](\d{1,2}):(\d{2})$/);
  const late = pickup ? "Выберите время, когда заберёте букет." : "На этот интервал уже не успеем. Выберите более поздний.";
  if (!m) return late;

  const st = +m[1] * 60 + +m[2], en = +m[3] * 60 + +m[4];
  const open = toMin(r.from), send = toMin(r.to);
  const till = pickup ? send : Math.max(toMin(r.till), send);
  const full = pickup ? r.step : r.hours * 60;

  if (st % r.step || en <= st) return late;
  if (st < open || st > send || en > till) return late;
  // окно либо целое, либо укороченное до закрытия, но не короче минимума
  if (en !== st + full && !(en === till && en - st >= Math.min(full, r.min))) return late;

  const now = moscowNow();
  if (dateIso < now.date) return "Эта дата уже прошла.";
  if (ready) {
    const wait = "Эти цветы ещё едут к нам — выберите время позже.";
    if (dateIso < ready.date) return wait;
    if (dateIso === ready.date && st < ready.minutes + prepFor(r, sum) - 20) return wait;
  }
  if (dateIso === now.date) {
    const ready = now.minutes + prepFor(r, sum) - 20;   // 20 минут поблажки: пока заполняли форму, время ушло
    if (st < ready) return late;
    if (Math.ceil(Math.max(open, ready) / r.step) * r.step > send) {
      return pickup ? "На сегодня забрать уже не получится. Выберите другую дату." : "На сегодня доставка уже не успеет. Выберите другую дату.";
    }
  }
  return "";
}

// Доставку считает карта — кругами от магазина или расстоянием от МКАД.


// В обоих случаях покупатель зону не выбирает и адрес проверяется на сервере.
const autoDelivery = (s) => !!(s.get("km_mode") || s.get("mkad_mode"));

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
  const take = [];        // что списать с остатков, когда заказ пройдёт все проверки
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
    // цену проверяем здесь: пустое поле в карточке даёт ноль, и букет уходил бы даром
    if (!(+price > 0)) fail(`У «${p.get("name")}» не указана цена. Позвоните нам — оформим вручную.`);
    // Остатки: сколько стеблей забронировано под сайт. Проверяем здесь, а списываем
    // ниже, когда весь заказ уже прошёл проверки — иначе списали бы под отказ.
    if (label) {
      const m = String(label).match(/^(\d+)-(\d+)$/);
      if (m && !stockOk(p, m[1], +m[2] * qty)) {
        const have = stockOf(p)[m[1]];
        fail(`«${p.get("name")}» ${m[1]} см: осталось ${have} ${have === 1 ? "цветок" : "штук"}. Уменьшите количество.`);
      }
      take.push({ p, len: m ? m[1] : "", stems: m ? +m[2] * qty : 0 });
    }
    items.push({ id: p.id, name: p.get("name"), label, label_text: label ? labelText(label) : "", price: +price, qty, sum: price * qty });
    sum += price * qty;
    bonus += (p.get("bonus") || 0) * qty;
  });
  if (sum < (s.get("min_order") || 0)) fail(`Минимальная сумма заказа — ${rub(s.get("min_order"))}.`);

  // Двойное нажатие «Оформить» давало два одинаковых заказа с разницей в секунды
  // (так вышло с №3041 и №3042). Отбиваем повтор: тот же телефон и та же сумма за две минуты.
  let twin = null;
  try {
    const tail = String(rec.get("phone") || "").replace(/\D/g, "").slice(-10);
    if (tail.length === 10) {
      const since = new Date(Date.now() - 2 * 60000).toISOString().replace("T", " ").slice(0, 19);
      // сравниваем сумму букетов: доставка считается ниже и у дубля может отличаться на копейки
      const same = app.findRecordsByFilter("orders",
        `phone ~ {:t} && items_sum = {:s} && created > {:since} && status != "cancelled"`,
        "-created", 1, 0, { t: tail, s: sum, since });
      if (same.length) twin = same[0];
    }
  } catch (_) {}
  if (twin) fail(`Такой заказ уже оформлен — №${twin.get("number")}. Если нужен второй букет, подождите пару минут.`);

  const pickup = String(rec.get("delivery_type") || "delivery") === "pickup";
  if (pickup && !s.get("pickup")) fail("Самовывоз сейчас недоступен.");
  rec.set("delivery_type", pickup ? "pickup" : "delivery");
  if (pickup) { rec.set("zone", ""); rec.set("address", s.get("pickup_address") || "Самовывоз"); }

  let delivery = 0;
  if (!pickup) {
    // Адрес всегда по частям: улица, дом, корпус, подъезд, этаж, квартира, домофон.
    const geo = require(`${__hooks}/lib/geo.js`);
    const parts = {};
    ["street", "house", "block", "entrance", "floor", "flat", "intercom"].forEach((k) => {
      parts[k] = String(rec.get(k) || "").trim();
      rec.set(k, parts[k]);
    });
    if (!parts.street) fail("Укажите улицу.");
    if (!parts.house) fail("Укажите дом.");
    rec.set("address", geo.addressLine(parts));

    if (autoDelivery(s)) {
      // Считает карта: круги от магазина или расстояние от МКАД. Адрес проверяем здесь заново: цену, которую
      // посчитал браузер, не принимаем на веру.
      const r = geo.check(app, s, parts, sum);
      if (!r.ok) fail(r.error);
      rec.set("zone", r.zone || "");
      rec.set("zone_name", r.zoneName || "");   // пояс словами — для разреза по географии
      rec.set("address", r.address);
      rec.set("lat", r.lat); rec.set("lon", r.lon);
      rec.set("distance_km", r.km);
      rec.set("mkad_km", r.out_km || 0);
      delivery = r.price;
    } else {
      const zoneId = rec.get("zone");
      if (zoneId) {
        let z;
        try { z = app.findRecordById("delivery_zones", zoneId); } catch (_) { fail("Выберите зону доставки."); }
        if (!z.get("active")) fail("Выберите зону доставки.");
        delivery = (z.get("free_from") > 0 && sum >= z.get("free_from")) ? 0 : (z.get("price") || 0);
      } else if (app.findRecordsByFilter("delivery_zones", "active = true", "", 1, 0).length) {
        fail("Выберите зону доставки.");
      }
    }
  }

  const date = String(rec.get("date"));
  const now = moscowNow();
  const closed = jget(s, "closed_dates") || [];
  if (date < now.date) fail("Эта дата уже прошла.");
  if (date > addDays(now.date, s.get("days_ahead") || 14)) fail("Выберите более близкую дату.");
  if (closed.indexOf(date) >= 0) fail("В этот день мы не доставляем. Выберите другую дату.");

  // интервал пересчитываем здесь заново: цену и время, присланные браузером, не принимаем на веру
  const interval = String(rec.get("interval") || "");
  // Проверяем правилами, а не списком: браузер и сервер считают время в разные секунды,
  // и точное совпадение строки давало отказ на верном интервале.
  const bad = slotProblem(s, date, sum, interval, pickup, readyOf(app, items));
  if (bad) fail(bad);

const card = !!(s.get("pay_card") && s.get("cp_public_id") && s.get("cp_secret"));
  const method = String(rec.get("payment_method") || "");
  if (method === "card" && !card) fail("Оплата картой сейчас недоступна.");
  // при получении платят только на самовывозе; пока карта не подключена — оставляем оплату при получении
  const onDeliveryOk = card ? (pickup && s.get("pay_on_delivery")) : true;
  if (method !== "card" && !onDeliveryOk) fail(pickup ? "Выберите оплату картой." : "Доставку нужно оплатить картой на сайте. Оплата при получении — только при самовывозе.");
  rec.set("payment_method", method === "card" ? "card" : "on_delivery");
  rec.set("payment_status", "unpaid");

  // первый заказ после чистки истории начинается с number_base, чтобы номера не повторялись в МоёмСкладе
  const last = app.findRecordsByFilter("orders", "number > 0", "-number", 1, 0);
  rec.set("number", last.length ? last[0].get("number") + 1 : (+s.get("number_base") || 1001));
  rec.set("status", "new");
  rec.set("items", items);
  rec.set("items_sum", sum);
  rec.set("delivery_price", delivery);
  rec.set("total", sum + delivery);
  rec.set("bonus", bonus);
  rec.set("comment", "");
  rec.set("tg_code", $security.randomString(10));   // по нему покупатель подпишется на статусы в боте
  // откуда пришёл человек — чтобы считать не только посетителей по источникам, но и деньги
  rec.set("source", String(rec.get("source") || "").slice(0, 60));
  rec.set("vid", String(rec.get("vid") || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 40));

  // Списываем остатки в самом конце, когда заказ уже прошёл все проверки.
  // Пишем запросом, а не сохранением товара: соседнее сохранение из копии,
  // прочитанной раньше, вернуло бы старое число обратно.
  take.forEach((t) => {
    if (!t.len || !t.stems) return;
    const st = stockOf(t.p);
    if (st[t.len] === undefined || st[t.len] === null) return;   // по этой длине учёта нет
    st[t.len] = Math.max(0, +st[t.len] - t.stems);
    try {
      app.db().newQuery("UPDATE products SET stock = {:v} WHERE id = {:id}")
        .bind({ v: JSON.stringify(st), id: t.p.id }).execute();
    } catch (err) { console.log("остаток", t.p.id, err); }
  });
}

// ---------- Телеграм ----------
// Одна попытка может не дойти (связь с Телеграмом иногда подвисает), поэтому пробуем дважды —
// иначе уведомление о заказе теряется совсем.
function tg(token, method, payload) {
  if (!token) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
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
      console.log("telegram error", method, attempt, err);
      if (attempt === 2) return null;
    }
  }
  return null;
}

// Фото отправляем файлом, а не ссылкой: Телеграм до нашего сервера не достукивается
// (по той же причине не работают их webhook'и), и на ссылку отвечал «failed to get HTTP URL content».
function tgPhoto(token, chat, path, caption, keyboard) {
  if (!token || !chat || !path) return null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const form = new FormData();
      form.append("chat_id", String(chat));
      if (caption) form.append("caption", String(caption).slice(0, 1000));
      if (keyboard) form.append("reply_markup", JSON.stringify(keyboard));
      form.append("photo", $filesystem.fileFromPath(path));
      const res = $http.send({
        url: `https://api.telegram.org/bot${token}/sendPhoto`,
        method: "POST",
        body: form,
        timeout: 60,
      });
      if (res.statusCode !== 200) console.log("telegram sendPhoto", res.statusCode, toString(res.body));
      return res.json;
    } catch (err) {
      console.log("telegram sendPhoto error", attempt, err);
      if (attempt === 2) return null;
    }
  }
  return null;
}

// ключ клиентского бота (если не задан — общий)

function clientToken(s) { return s.get("tg_client_token") || s.get("tg_token"); }

function adminIds(s) {
  return String(s.get("tg_admins") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}
// Флористы: в служебном боте им можно только отправлять фото готовых букетов
function floristIds(s) {
  return String(s.get("tg_florists") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

function orderText(o) {
  const items = (jget(o, "items") || []).map((it) => `• ${it.name}${it.label_text ? " · " + it.label_text : ""} × ${it.qty} — ${rub(it.sum)}`).join("\n");
  return [
    `🧾 Заказ №${o.get("number")} — ${STATUS[o.get("status")] || o.get("status")}`,
    "",
    items,
    `Доставка: ${rub(o.get("delivery_price") || 0)}`,
`Итого: ${rub(o.get("total") || 0)}`,
o.get("payment_method") === "card" ? (o.get("payment_status") === "paid" ? "💳 Оплачено картой" : "💳 Ожидает оплаты картой") : "💵 Оплата при получении",
    "",
    `📅 ${dateRu(o.get("date"))}, ${o.get("interval") || "—"}`,
    o.get("delivery_type") === "pickup" ? `🏪 Самовывоз: ${o.get("address")}` :
      `📍 ${o.get("address")}${o.get("distance_km") ? ` (${o.get("distance_km")} км)` : ""}`,
    `👤 ${o.get("name")}, ${o.get("phone")}`,
    o.get("recipient") ? `🎁 Получатель: ${o.get("recipient")}` : "",
    o.get("note") ? `💌 Открытка: ${o.get("note")}` : "",
    o.get("tg_chat") ? "📱 Клиент подписан на статусы в Телеграме" : o.get("max_chat") ? "📱 Клиент подписан на статусы в MAX" : "",
    o.get("photo_status") === "approved" ? "👍 Клиент одобрил фото" : o.get("photo_status") === "rework" ? `👎 Клиент просит поправить: ${o.get("photo_comment") || "без комментария"}` : o.get("photo_status") === "waiting" ? "⏳ Ждём ответ клиента по фото" : "",
  ].filter((x) => x !== "").join("\n");
}

// Статус заказа меняется только в МоёмСкладе (ms-status.pb.js тянет его раз в минуту),
// поэтому кнопок смены статуса в боте нет — иначе бот и МойСклад перебивали бы друг друга.
function orderKeyboard(o) {
  return { inline_keyboard: [[{ text: "📷 Отправить фото букета клиенту", callback_data: `fo:${o.id}` }]] };
}

// Что видит флорист: что собрать и к какому времени. Ни телефона, ни адреса,
// ни имени — ему это не нужно, а персональные данные по чатам гулять не должны.
function floristText(o) {
  const items = (jget(o, "items") || []).map((it) => `• ${it.name}${it.label_text ? " · " + it.label_text : ""} × ${it.qty}`).join("\n");
  return `🌸 Заказ №${o.get("number")} — ${STATUS[o.get("status")] || o.get("status")}\n${items}\n\n${o.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${whenText(o)}`
    + (o.get("note") ? `\nОткрытка: ${o.get("note")}` : "");
}

// Клавиатура флориста: внизу всегда висят номера заказов, по которым фото ещё не ушло.
// Нажал номер — бот ждёт фото именно для него. Ничего печатать не нужно.
function floristKeyboard(app) {
  let live = [];
  try {
    // только свежие: зависшие вчерашние заказы не должны загромождать клавиатуру
    const since = new Date(Date.now() - 2 * 864e5).toISOString().replace("T", " ").slice(0, 19);
    live = app.findRecordsByFilter("orders",
      `status != "done" && status != "cancelled" && photo_file_id = "" && created > {:since}`,
      "number", 12, 0, { since });
  } catch (_) {}
  const rows = [];
  for (let i = 0; i < live.length; i += 3) {
    rows.push(live.slice(i, i + 3).map((o) => ({ text: `№${o.get("number")}` })));
  }
  rows.push([{ text: "Обновить список" }]);
  return { keyboard: rows, resize_keyboard: true, is_persistent: true,
    input_field_placeholder: live.length ? "Нажмите номер заказа и пришлите фото" : "Заказов без фото нет" };
}

function notifyOrder(app, o) {
  const s = settings(app);
  const token = s.get("tg_token");
  adminIds(s).forEach((chat) => tg(token, "sendMessage", { chat_id: chat, text: orderText(o), reply_markup: orderKeyboard(o) }));
  floristIds(s).forEach((chat) => {
    tg(token, "sendMessage", { chat_id: chat, text: floristText(o), reply_markup: orderKeyboard(o) });
    tg(token, "sendMessage", { chat_id: chat, text: "Ждут фото — нажмите номер:", reply_markup: floristKeyboard(app) });
  });
}

// Сообщения покупателю в Телеграм (если он подписался)
const CUSTOMER_TEXT = {
  confirmed: (o) => `Заказ №${o.get("number")} подтверждён. Соберём и пришлём фото перед доставкой.`,
  assembling: (o) => `Заказ №${o.get("number")}: начали собирать ваш букет.`,
  photo: (o) => o.get("delivery_type") === "pickup"
    ? `Заказ №${o.get("number")}: букет готов, ждём вас ${whenText(o)}.`
    : `Заказ №${o.get("number")}: букет собран, скоро выезжаем.`,
  delivering: (o) => `Заказ №${o.get("number")} в пути. Доставим ${whenText(o)}.` +
    (o.get("comment") ? `\nКурьер: ${o.get("comment")}` : ""),
  done: (o) => o.get("delivery_type") === "pickup"
    ? `Заказ №${o.get("number")} выдан. Спасибо, что выбрали venikoff.net!`
    : `Заказ №${o.get("number")} доставлен. Спасибо, что выбрали venikoff.net!`,
  cancelled: (o) => `Заказ №${o.get("number")} отменён. Если это ошибка — позвоните нам.`,
};
// Покупатель мог подписаться в Телеграме или в MAX — пишем туда, где он есть.
function notifyCustomer(app, o, status) {
  const make = CUSTOMER_TEXT[status];
  if (!make) return;
  const tgChat = o.get("tg_chat"), maxChat = o.get("max_chat");
  if (!tgChat && !maxChat) return;
  const s = settings(app);
  const text = make(o);
  // Если сообщение не ушло — покупатель об этом не узнает, поэтому говорим владельцу.
  const failed = [];
  if (tgChat) {
    const r = tg(clientToken(s), "sendMessage", { chat_id: tgChat, text });
    if (!r || !r.ok) failed.push(`Телеграм (${(r && r.description) || "нет ответа"})`);
  }
  if (maxChat) {
    // подключаем здесь, а не сверху: иначе два модуля требуют друг друга
    try {
      const r = require(`${__hooks}/lib/max.js`).send(s.get("max_token"), maxChat, text);
      if (!r || !r.ok) failed.push(`MAX (${(r && r.error) || "нет ответа"})`);
    } catch (err) { console.log("max notify", err); failed.push("MAX (ошибка)"); }
  }
  if (failed.length) {
    adminIds(s).forEach((chat) => tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `⚠️ Заказ №${o.get("number")}: не удалось сообщить покупателю — ${failed.join(", ")}.\nПозвоните: ${o.get("name")}, ${o.get("phone")}` }));
  }
}

module.exports = {
  STATUS, COUNTS, rub, jget, settings, role, can, claim, unclaim, moscowToday, fileUrl, labelText, estimateVariants, variantsOf, priceTables, catalog, prepareOrder, notifyCustomer, readyOf, stockOf, stockOk,
  tg, tgPhoto, clientToken, adminIds, floristIds, floristText, floristKeyboard, orderText, orderKeyboard, notifyOrder, dateRu, whenText, autoDelivery, slotRules, slotsFor, slotProblem,
};
