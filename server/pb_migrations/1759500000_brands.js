/// <reference path="../pb_data/types.d.ts" />
// Две витрины на одном сервере и в одной базе.
// Кто пришёл — понимаем по домену запроса, поэтому код и каталог общие,
// а оформление, набор товаров и клиентский бот у каждой витрины свои.
// Склад и остатки общие: магазин один, товар один.
migrate((app) => {
  const brands = new Collection({
    type: "base",
    name: "brands",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "slug", type: "text", required: true, max: 40 },
      { name: "name", type: "text", required: true, max: 80 },   // как называть себя на сайте
      { name: "domain", type: "text", max: 120 },                // по нему и узнаём витрину
      { name: "accent", type: "text", max: 20 },                 // основной цвет, светлая тема
      { name: "accent_text", type: "text", max: 20 },            // он же для текста (темнее)
      { name: "accent_dark", type: "text", max: 20 },            // основной цвет, тёмная тема
      { name: "accent_text_dark", type: "text", max: 20 },
      { name: "tag_color", type: "text", max: 20 },              // метка витрины в админке
      { name: "tg_client_token", type: "text" },                 // свой бот для покупателей
      { name: "tg_client_bot", type: "text", max: 80 },
      { name: "tg_link", type: "text", max: 200 },               // «Написать в Телеграм» в подвале
      { name: "phone", type: "text", max: 40 },
      { name: "address", type: "text", max: 200 },               // строка в подвале
      { name: "active", type: "bool" },
      { name: "sort", type: "number" },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_brands_slug ON brands (slug)"],
  });
  app.save(brands);

  // Витрины у товара: галочки в карточке. Пусто — товар не показывается нигде.
  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "brands", type: "relation", collectionId: brands.id, maxSelect: 0, cascadeDelete: false }));
  app.save(p);

  // Откуда пришёл заказ и диалог — чтобы в общем списке было видно
  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "brand", type: "relation", collectionId: brands.id, maxSelect: 1, cascadeDelete: false }));
  app.save(o);
  const c = app.findCollectionByNameOrId("chats");
  c.fields.add(new Field({ name: "brand", type: "relation", collectionId: brands.id, maxSelect: 1, cascadeDelete: false }));
  app.save(c);

  // Первая витрина — нынешняя, с её сегодняшними цветами и ботом
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  const v = new Record(brands);
  v.set("slug", "venikoff");
  v.set("name", "venikoff.net");
  v.set("domain", "venikoff.net");
  v.set("accent", "#E0178A");
  v.set("accent_text", "#C0106F");
  v.set("accent_dark", "#F0339E");
  v.set("accent_text_dark", "#FF7CC4");
  v.set("tag_color", "#E0178A");
  v.set("tg_client_token", s.get("tg_client_token") || "");
  v.set("tg_client_bot", s.get("tg_client_bot") || "");
  v.set("tg_link", "https://t.me/venikoff_net");
  v.set("phone", s.get("phone") || "");
  v.set("address", "Москва, Маленковская улица, 14к1");
  v.set("active", true);
  v.set("sort", 1);
  app.save(v);

  // Всё, что уже есть, принадлежит первой витрине — иначе сайт опустеет
  app.findRecordsByFilter("products", "id != ''", "", 2000, 0).forEach((x) => {
    x.set("brands", [v.id]);
    app.save(x);
  });
  ["orders", "chats"].forEach((n) => {
    app.findRecordsByFilter(n, "id != ''", "", 5000, 0).forEach((x) => {
      x.set("brand", v.id);
      app.save(x);
    });
  });
}, (app) => {
  ["products", "orders", "chats"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    c.fields.removeByName(n === "products" ? "brands" : "brand");
    app.save(c);
  });
  try { app.delete(app.findCollectionByNameOrId("brands")); } catch (_) {}
});
