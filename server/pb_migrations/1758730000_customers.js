/// <reference path="../pb_data/types.d.ts" />
// Личный кабинет покупателя: вход через Телеграм, свои заказы.
migrate((app) => {
  const MANAGER = '@request.auth.collectionName = "managers"';

  const customers = new Collection({
    type: "base",
    name: "customers",
    listRule: MANAGER, viewRule: MANAGER, createRule: null, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "name", type: "text", max: 120 },
      { name: "phone", type: "text", max: 40 },
      { name: "tg_chat", type: "text" },
      { name: "tg_name", type: "text" },
      { name: "token", type: "text" },        // ключ сессии сайта
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_customers_chat ON customers (tg_chat)"],
  });
  app.save(customers);

  const logins = new Collection({
    type: "base",
    name: "logins",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "code", type: "text", required: true },
      { name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_logins_code ON logins (code)"],
  });
  app.save(logins);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "customer", type: "relation", collectionId: customers.id, maxSelect: 1 }));
  app.save(o);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("customer");
  app.save(o);
  ["logins", "customers"].forEach((n) => { try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {} });
});
