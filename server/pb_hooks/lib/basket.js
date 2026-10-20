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

// Разбор и проверка корзины из заказа. Возвращает готовую позицию, что списать
// с остатков и надбавку к доставке.
function разобрать(app, s, it) {
  const беда = (m) => { throw new BadRequestError(m); };
  let основа;
  try { основа = app.findRecordById("baskets", String(it.basket || "")); } catch (_) { беда("Корзина больше недоступна. Соберите заново."); }
  if (!основа.get("active") || !(+основа.get("price") > 0)) беда("Эта корзина сейчас не продаётся.");

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

  if (мест > (+основа.get("capacity") || 0)) {
    беда(`В «${основа.get("name")}» столько не помещается: нужна корзина побольше.`);
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
  сумма += +основа.get("price") || 0;

  // Надбавка к доставке: у сорта она задана по количеству, иначе берём у основы.
  let dx = +основа.get("delivery_extra") || 0;
  состав.forEach((x) => {
    let p; try { p = app.findRecordById("products", x.id); } catch (_) { return; }
    const строки = shop.jget(p, "basket_counts");
    if (!Array.isArray(строки)) return;
    const подходит = строки.filter((r) => +r.qty <= стеблей).sort((a, b) => b.qty - a.qty)[0];
    if (подходит && +подходит.delivery_extra > dx) dx = +подходит.delivery_extra;
  });

  const имя = `Корзина ${стеблей} ${стеблей === 1 ? "роза" : "шт"}: ` + состав.map((x) => `${x.name} ${x.len}см ×${x.n}`).join(", ");
  return {
    item: {
      kind: "basket", basket: основа.id, basket_name: основа.get("name"),
      name: имя, label: "", label_text: "", qty: 1,
      price: сумма, sum: сумма,
      stems: стеблей, units: мест, parts: состав,
      oasis: +основа.get("oasis_qty") || 0,
    },
    take, dx,
  };
}

module.exports = { разобрать, ценаСтебля, МАКС_СОРТОВ };
