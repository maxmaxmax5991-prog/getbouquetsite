/// <reference path="../pb_data/types.d.ts" />
// Оценка после вручения: оформление на сайте, сам букет, доставка.
// Спрашиваем по одному вопросу — стена из пятнадцати кнопок отпугивает,
// а по одному отвечают почти все.
migrate((app) => {
  const orders = app.findCollectionByNameOrId("orders");
  const customers = app.findCollectionByNameOrId("customers");
  const c = new Collection({
    name: "reviews",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "order", type: "relation", collectionId: orders.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1, cascadeDelete: false },
      { name: "q_order", type: "number" },      // удобство оформления
      { name: "q_bouquet", type: "number" },    // сам букет
      { name: "q_delivery", type: "number" },   // доставка
      { name: "comment", type: "text", max: 1000 },
      { name: "step", type: "select", maxSelect: 1, values: ["order", "bouquet", "delivery", "comment", "done"] },
      { name: "via", type: "select", maxSelect: 1, values: ["tg", "max"] },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_reviews_order ON reviews (`order`)"],
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("reviews")); } catch (_) {}
});
