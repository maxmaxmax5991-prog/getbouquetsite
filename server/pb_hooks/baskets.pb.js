/// <reference path="../pb_data/types.d.ts" />
// Корзины и кашпо: привязка основ к складу.
//
// Без номера номенклатуры заказ с корзиной в МойСклад не уедет — туда нужна
// ссылка на товар, а не название. Поэтому привязку делаем заранее и по кнопке,
// а не в момент заказа: искать по сети при каждой отправке мы уже обжигались
// (так терялись доставка и канал продаж).
routerAdd("POST", "/api/shop/baskets-ms", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const s = shop.settings($app);
  if (!s.get("ms_token")) return e.json(400, { message: "Токен МоегоСклада не задан." });

  let список = [];
  try { список = $app.findRecordsByFilter("baskets", "id != ''", "sort", 200, 0); } catch (_) {}
  let привязано = 0;
  const нет = [];
  список.forEach((b) => {
    const имя = String(b.get("ms_name") || b.get("name") || "").trim();
    if (!имя) { нет.push(b.get("name") || "без названия"); return; }
    const r = msl.ms(s, "GET", `/entity/assortment?filter=${encodeURIComponent("name=" + имя)}&limit=1`);
    const строки = (r.ok && r.data && r.data.rows) || [];
    if (!строки.length) { нет.push(имя); return; }
    const x = строки[0];
    // Пишем запросом, мимо хуков: соседнее сохранение из старой копии вернуло
    // бы поле в пустоту — на этом уже обжигались с ms_id у заказов.
    try {
      $app.db().newQuery("UPDATE baskets SET ms_id = {:v} WHERE id = {:id}")
        .bind({ v: String(x.id), id: b.id }).execute();
      привязано++;
    } catch (err) { console.log("корзины: привязка", имя, err); нет.push(имя); }

    // Оазис той же кнопкой: он уходит в заказ отдельной позицией, и без номера
    // с типом её не собрать. Тип обязателен — комплект нельзя класть товаром.
    const оИмя = String(b.get("oasis_name") || "").trim();
    if (оИмя && !b.get("oasis_id")) {
      const ro = msl.ms(s, "GET", `/entity/assortment?filter=${encodeURIComponent("name=" + оИмя)}&limit=1`);
      const о = (ro.ok && ro.data && ro.data.rows) || [];
      if (о.length) {
        try {
          $app.db().newQuery("UPDATE baskets SET oasis_id = {:v}, oasis_type = {:t} WHERE id = {:id}")
            .bind({ v: String(о[0].id), t: String((о[0].meta && о[0].meta.type) || "product"), id: b.id }).execute();
        } catch (err) { console.log("корзины: оазис", оИмя, err); }
      } else нет.push(оИмя);
    }
  });
  return e.json(200, { всего: список.length, привязано, нет });
}, $apis.requireAuth("managers"));

// Всё, что нужно конструктору на витрине, одним запросом: основы, примеры,
// цены за стебель, места и отметки по категориям. Одним — чтобы страница не
// моргала, собирая это по кускам, и чтобы правила считал сервер: цену из
// браузера принимать нельзя, он её только показывает.
routerAdd("GET", "/api/shop/basket-setup", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);

  let основы = [];
  try { основы = $app.findRecordsByFilter("baskets", "active = true", "sort", 200, 0); } catch (_) {}
  основы = основы.filter((b) => +b.get("price") > 0);

  let примеры = [];
  try { примеры = $app.findRecordsByFilter("basket_samples", "active = true", "sort", 100, 0); } catch (_) {}

  let разделы = [];
  try { разделы = $app.findRecordsByFilter("categories", "active = true", "sort", 100, 0); } catch (_) {}

  let цены = {};
  try { цены = JSON.parse(s.getString("basket_prices") || "{}") || {}; } catch (_) { цены = {}; }

  return e.json(200, {
    основы: основы.map((b) => ({
      id: b.id, name: b.get("name"), kind: b.get("kind") || "корзина",
      capacity: +b.get("capacity") || 0, price: +b.get("price") || 0,
      delivery_extra: +b.get("delivery_extra") || 0, tile: !!b.get("tile"),
      img: (b.get("photo") || []).length ? shop.fileUrl(b, (b.get("photo") || [])[0], "560x0") : "",
    })),
    примеры: примеры.map((x) => ({
      id: x.id, qty: +x.get("qty") || 0, product: x.get("product") || "", name: x.get("name") || "",
      parts: x.get("parts") || [],
      img: x.get("photo") ? shop.fileUrl(x, x.get("photo"), "560x0") : "",
      big: x.get("photo") ? shop.fileUrl(x, x.get("photo"), "1120x0") : "",
    })).filter((x) => x.img),
    // Карточка «Соберите корзину» в ряду каталога: берём помеченный пример.
    плитка: (() => {
      const x = примеры.find((y) => y.get("tile") && y.get("photo"));
      if (!x) return null;
      return { id: x.id, qty: +x.get("qty") || 0, product: x.get("product") || "",
        parts: x.get("parts") || [],
        name: x.get("name") || "", img: shop.fileUrl(x, x.get("photo"), "560x0"),
        img2: shop.fileUrl(x, x.get("photo"), "1120x0") };
    })(),
    разделы: разделы.map((c) => ({
      slug: c.get("slug"), name: c.get("name"),
      units: +c.get("basket_units") || 1,
      marks: String(c.get("basket_marks") || "").split(",").map((x) => parseInt(x, 10)).filter((x) => x > 0),
    })).filter((c) => c.marks.length),
    // цена стебля в корзине: группа прайса → ступень количества → ростовка.
    // Пусто — считаем по обычному прайсу: набор 101 шт делим на 101.
    цены,
  });
});

// Список основ для сайта: только включённые и с ценой — показывать корзину,
// которую нельзя продать, незачем.
routerAdd("GET", "/api/shop/baskets", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  let список = [];
  try { список = $app.findRecordsByFilter("baskets", "active = true", "sort", 200, 0); } catch (_) {}
  return e.json(200, {
    основы: список.filter((b) => +b.get("price") > 0).map((b) => ({
      id: b.id, name: b.get("name"), kind: b.get("kind") || "корзина",
      capacity: +b.get("capacity") || 0, price: +b.get("price") || 0,
      delivery_extra: +b.get("delivery_extra") || 0,
      oasis_qty: +b.get("oasis_qty") || 0,
      img: (b.get("photo") || []).length ? shop.fileUrl(b, (b.get("photo") || [])[0], "560x0") : "",
    })),
  });
});
