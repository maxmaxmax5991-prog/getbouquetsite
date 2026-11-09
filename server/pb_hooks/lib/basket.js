// Корзина как одна позиция заказа: основа + до трёх сортов.
//
// Всё считает сервер. Из браузера приходит только намерение — какая основа,
// какие сорта, сколько стеблей и какой ростовки. Цену, вместимость и остатки
// пересчитываем заново: присланной сумме верить нельзя, как и в обычном заказе.
const shop = require(`${__hooks}/lib/shop.js`);

const МАКС_СОРТОВ = 3;

// Цена одного стебля в корзине. Сначала смотрим свой прайс корзин
// (группа → ступень количества → ростовка), и только если там пусто — считаем
// по обычному прайсу: набор 101 шт делим на 101. Это правило владельца.
function ценаСтебля(app, s, p, len, всего) {
  const группа = String(p.get("price_table") || "");
  let карта = {};
  try { карта = JSON.parse(s.getString("basket_prices") || "{}") || {}; } catch (_) { карта = {}; }
  const ступени = карта[группа];
  if (ступени) {
    const годные = Object.keys(ступени).map(Number).filter((n) => n > 0 && n <= всего).sort((a, b) => b - a);
    for (const n of годные) {
      const v = +(ступени[String(n)] || {})[String(len)];
      if (v > 0) return v;
    }
  }
  const таблица = shop.priceTables(s).find((t) => t.id === группа);
  const строка = таблица && (таблица.prices || {})[String(len)];
  if (!строка) return 0;
  const ключ = строка["101"] !== undefined ? "101"
    : Object.keys(строка).sort((a, b) => Math.abs(+a - 101) - Math.abs(+b - 101))[0];
  return ключ ? +строка[ключ] / +ключ : 0;
}

// Формы из цветов: сердце и буквы. Каркас заменяет корзину, цветы те же и
// берутся из общего количества (решение владельца 09.11.2026). Пороги заданы
// в настройках, чтобы менять их без выкладки.
function формы(s) {
  let f = {};
  try { f = JSON.parse(s.getString("basket_shapes") || "{}") || {}; } catch (_) { f = {}; }
  const h = f.heart || {};
  return {
    heart: { name: String(h.name || "Сердце"), price: Math.max(0, +h.price || 0), from: Math.max(0, +h.from || 0) },
    letter_price: Math.max(0, +f.letter_price || 0),
    letters: (Array.isArray(f.letters) ? f.letters : [])
      .map((x) => ({ max: Math.max(0, +x.max || 0), from: Math.max(0, +x.from || 0) }))
      .filter((x) => x.max && x.from).sort((a, b) => a.from - b.from),
  };
}

// Сколько букв можно выложить при таком количестве цветов. 0 — нельзя ни одной.
function буквДоступно(f, стеблей) {
  let n = 0;
  f.letters.forEach((x) => { if (стеблей >= x.from) n = Math.max(n, x.max); });
  return n;
}

// Разбор и проверка корзины из заказа. Возвращает готовую позицию, что списать
// с остатков и надбавку к доставке.
function разобрать(app, s, it) {
  const беда = (m) => { throw new BadRequestError(m); };
  const ф = формы(s);
  const форма = String(it.shape || "").trim();           // "" — обычная корзина
  if (форма && форма !== "heart" && форма !== "letters") беда("Неизвестная форма.");
  // Буквы: только русские и латинские буквы, цифры и пробел. Пробел считаем
  // знаком — «МАМА» и «С 8 МАРТА» выкладываются по-разному, но каркас один.
  const буквы = форма === "letters"
    ? String(it.text || "").toUpperCase().replace(/[^0-9A-ZА-ЯЁ ]/g, "").trim().slice(0, 10) : "";
  if (форма === "letters" && !буквы) беда("Напишите, какие буквы выложить.");

  let основа = null;
  if (!форма) {
    try { основа = app.findRecordById("baskets", String(it.basket || "")); } catch (_) { беда("Корзина больше недоступна. Соберите заново."); }
    if (!основа.get("active") || !(+основа.get("price") > 0)) беда("Эта корзина сейчас не продаётся.");
  }

  const части = Array.isArray(it.parts) ? it.parts : [];
  if (!части.length) беда("В корзине нет цветов.");
  if (части.length > МАКС_СОРТОВ) беда(`В одну корзину ставим не больше ${МАКС_СОРТОВ} сортов.`);

  let мест = 0, стеблей = 0, раздел = null, сумма = 0;
  const состав = [], take = [];
  части.forEach((ч) => {
    let p;
    try { p = app.findRecordById("products", String(ч.id || "")); } catch (_) { беда("Один из сортов больше недоступен."); }
    if (!p.get("active")) беда(`«${p.get("name")}» сейчас недоступен.`);
    const n = Math.floor(+ч.n || 0);
    if (!(n >= 1 && n <= 2000)) беда(`Неверное количество у «${p.get("name")}».`);
    const len = String(parseInt(ч.len, 10) || 0);
    if (!len || len === "0") беда(`Выберите длину для «${p.get("name")}».`);

    let c = null;
    try { c = app.findRecordById("categories", p.get("category")); } catch (_) {}
    if (!c) беда(`У «${p.get("name")}» не указан раздел.`);
    // Смешивать категории нельзя: кустовая и одноголовая в одной корзине не
    // уживаются ни по сборке, ни по вместимости.
    if (раздел && раздел !== c.id) беда("В одной корзине только цветы одного вида. Уберите лишний сорт.");
    раздел = c.id;
    const ед = Math.max(1, +c.get("basket_units") || 1);

    if (!shop.stockOk(p, len, n)) {
      const есть = +shop.stockOf(p)[len] || 0;
      беда(`«${p.get("name")}» ${len} см: осталось ${есть} шт. Уменьшите количество.`);
    }
    take.push({ p, len, stems: n });
    мест += n * ед;
    стеблей += n;
    состав.push({ id: p.id, name: p.get("name"), len: +len, n });
  });

  if (!форма && мест > (+основа.get("capacity") || 0)) {
    беда(`В «${основа.get("name")}» столько не помещается: нужна корзина побольше.`);
  }
  // Пороги формы считаем по стеблям: «сердце от 150 роз», «три буквы от 301».
  let каркас = 0;
  if (форма === "heart") {
    if (стеблей < ф.heart.from) беда(`Сердце собираем от ${ф.heart.from} цветов. Добавьте количество.`);
    каркас = ф.heart.price;
  } else if (форма === "letters") {
    const можно = буквДоступно(ф, стеблей);
    const надо = буквы.replace(/ /g, "").length;
    if (!можно) беда(`Буквы выкладываем от ${(ф.letters[0] || {}).from || 0} цветов. Добавьте количество.`);
    if (надо > можно) беда(`Из ${стеблей} цветов выкладываем не больше ${можно} ${можно === 1 ? "буквы" : "букв"}.`);
    // Цена за выкладку целиком, а не за букву (поправка владельца 09.11.2026)
    каркас = ф.letter_price;
  }

  // Цена стебля зависит от общего количества, поэтому считаем её после того,
  // как собрали весь набор.
  состав.forEach((x) => {
    let p; try { p = app.findRecordById("products", x.id); } catch (_) { return; }
    const за = ценаСтебля(app, s, p, x.len, стеблей);
    if (!(за > 0)) беда(`У «${x.name}» ${x.len} см не задана цена для корзины.`);
    x.price = Math.round(за * 100) / 100;
    x.sum = Math.round(за * x.n);
    сумма += x.sum;
  });
  сумма += форма ? каркас : (+основа.get("price") || 0);

  // Надбавка к доставке: у сорта она задана по количеству, иначе берём у основы.
  let dx = основа ? (+основа.get("delivery_extra") || 0) : 0;
  состав.forEach((x) => {
    let p; try { p = app.findRecordById("products", x.id); } catch (_) { return; }
    const строки = shop.jget(p, "basket_counts");
    if (!Array.isArray(строки)) return;
    const подходит = строки.filter((r) => +r.qty <= стеблей).sort((a, b) => b.qty - a.qty)[0];
    if (подходит && +подходит.delivery_extra > dx) dx = +подходит.delivery_extra;
  });

  const заголовок = форма === "heart" ? `${ф.heart.name} из ${стеблей} шт`
    : форма === "letters" ? `Буквы «${буквы}» из ${стеблей} шт`
    : `Корзина ${стеблей} ${стеблей === 1 ? "роза" : "шт"}`;
  const имя = `${заголовок}: ` + состав.map((x) => `${x.name} ${x.len}см ×${x.n}`).join(", ");
  return {
    item: {
      kind: "basket",
      basket: основа ? основа.id : "", basket_name: основа ? основа.get("name") : заголовок,
      shape: форма, shape_text: буквы, frame: каркас,
      name: имя, label: "", label_text: "", qty: 1,
      price: сумма, sum: сумма,
      stems: стеблей, units: мест, parts: состав,
      oasis: основа ? (+основа.get("oasis_qty") || 0) : 0,
    },
    take, dx,
  };
}

module.exports = { разобрать, ценаСтебля, формы, буквДоступно, МАКС_СОРТОВ };
