/// <reference path="../pb_data/types.d.ts" />
// Свой чат на сайте. Переписка живёт у нас: отвечаем из админки или реплаем
// в служебном боте, данные покупателей не уезжают в чужие сервисы (152-ФЗ).
//
// Диалог заводится на посетителя, даже если он не вошёл в кабинет: его узнаём
// по случайному ключу в браузере. Вошёл — привязываем к покупателю и видим заказы.
migrate((app) => {
  const chats = new Collection({
    name: "chats",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", max: 64, required: true },   // ключ посетителя из браузера
      { name: "customer", type: "relation", collectionId: app.findCollectionByNameOrId("customers").id, maxSelect: 1, cascadeDelete: false },
      { name: "name", type: "text", max: 120 },
      { name: "phone", type: "text", max: 40 },
      { name: "last_text", type: "text", max: 300 },
      { name: "last_at", type: "text", max: 40 },
      { name: "unread", type: "number" },        // сколько сообщений покупателя мы не прочитали
      { name: "answered", type: "bool" },        // на последнее сообщение ответили
      { name: "closed", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_chats_token ON chats (token)"],
  });
  app.save(chats);

  const msgs = new Collection({
    name: "chat_messages",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "chat", type: "relation", collectionId: app.findCollectionByNameOrId("chats").id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "side", type: "select", maxSelect: 1, required: true, values: ["client", "shop"] },
      { name: "text", type: "text", max: 2000, required: true },
      { name: "author", type: "text", max: 120 },   // кто из наших ответил
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE INDEX idx_msg_chat ON chat_messages (chat, created)"],
  });
  app.save(msgs);
}, (app) => {
  ["chat_messages", "chats"].forEach((n) => {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  });
});
