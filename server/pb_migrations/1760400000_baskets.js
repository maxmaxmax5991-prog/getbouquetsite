/// <reference path="../pb_data/types.d.ts" />
// Корзины и кашпо: справочник основ и настройка «какой сорт в какую корзину».
//
// Зачем отдельный справочник, а не поле в товаре. Корзина — самостоятельная
// вещь со своей ценой, вместимостью, складской номенклатурой и доплатой за
// доставку. Один и тот же «ЛФ-Корзина большая» вяжется к десяткам сортов;
// держать это копиями в каждой карточке — гарантированно разъедется.
//
// Вместимость (`capacity`) — сколько стеблей влезает. По ней конструктор на
// сайте не даст набрать больше, чем корзина держит.
//
// `products.basket_counts` — у сорта список «количество → какая корзина»:
// [{ qty: 101, basket: "<id>" }, { qty: 251, basket: "<id>" }]. Владелец
// задаёт это руками: в 101 розу одного сорта и в 101 другого влезают разные
// корзины, общего правила нет.
const MANAGER = '@request.auth.collectionName = "managers"';
const OWNER = MANAGER + ' && @request.auth.role = "owner"';

migrate((app) => {
  try { app.findCollectionByNameOrId("baskets"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "baskets",
      listRule: "", viewRule: "",            // список нужен сайту: покупатель выбирает основу
      createRule: OWNER, updateRule: OWNER, deleteRule: OWNER,
      fields: [
        { name: "name", type: "text", max: 120, required: true },   // как видит покупатель
        { name: "kind", type: "text", max: 20 },                    // «корзина» или «кашпо»
        { name: "capacity", type: "number", min: 0 },               // стеблей влезает
        { name: "price", type: "number", min: 0 },                  // цена основы (оазис внутри)
        { name: "delivery_extra", type: "number", min: 0 },         // доплата за доставку
        { name: "ms_name", type: "text", max: 200 },                // точное имя на складе
        { name: "ms_id", type: "text", max: 60 },                   // номер номенклатуры
        { name: "photo", type: "file", maxSelect: 3, maxSize: 15 * 1024 * 1024,
          mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["560x0", "1120x0", "160x160"] },
        { name: "sort", type: "number" },
        { name: "active", type: "bool" },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
    }));
  }

  const p = app.findCollectionByNameOrId("products");
  if (!p.fields.getByName("basket_counts")) p.fields.add(new Field({ name: "basket_counts", type: "json" }));
  app.save(p);

  // Семь основ со слов владельца (19.10.2026). Цены и складские привязки
  // проставляются в админке: у трёх существующих они есть на складе, остальные
  // четыре там ещё предстоит завести.
  const ОСНОВЫ = [
    ["ЛФ-Корзина маленькая", 101], ["ЛФ-Корзина средняя", 150], ["ЛФ-Корзина большая", 250],
    ["ЛФ-Корзина XL", 350], ["ЛФ-Корзина XXL", 550], ["ЛФ-Корзина XXXL", 800], ["ЛФ-Корзина XXXXL", 1000],
  ];
  const c = app.findCollectionByNameOrId("baskets");
  ОСНОВЫ.forEach(([имя, вместимость], i) => {
    let есть = [];
    try { есть = app.findRecordsByFilter("baskets", "name = {:n}", "", 1, 0, { n: имя }); } catch (_) {}
    if (есть.length) return;
    const r = new Record(c);
    r.set("name", имя); r.set("kind", "корзина"); r.set("capacity", вместимость);
    r.set("ms_name", имя); r.set("sort", i); r.set("active", false);   // включим, когда будут цены
    app.save(r);
  });
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("basket_counts");
  app.save(p);
  try { app.delete(app.findCollectionByNameOrId("baskets")); } catch (_) {}
});
