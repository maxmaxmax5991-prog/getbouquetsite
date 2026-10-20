/// <reference path="../pb_data/types.d.ts" />
// Кому ушла рассылка — чтобы потом посчитать, сколько она принесла.
//
// Денег два счёта, и они отвечают на разные вопросы:
//   по ссылке — кто нажал кнопку в сообщении и заказал (метка utm в ссылке);
//   по получателям — кто получил сообщение и заказал потом как угодно, хоть
//   по телефону. Второй счёт без списка получателей не собрать, поэтому и
//   пишем строку на каждое доставленное сообщение.
//
// Таблица служебная: смотрит её только владелец, витрине она не нужна.
const OWNER = '@request.auth.collectionName = "managers" && @request.auth.role = "owner"';
migrate((app) => {
  try { app.findCollectionByNameOrId("bc_sent"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "bc_sent",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: OWNER,
      fields: [
        { name: "bc", type: "text", max: 40 },        // какая рассылка
        { name: "customer", type: "text", max: 40 },  // карточка покупателя, если известна
        { name: "chat", type: "text", max: 40 },      // номер собеседника
        { name: "kind", type: "text", max: 10 },      // tg | max
        { name: "created", type: "autodate", onCreate: true },
      ],
      indexes: [
        "CREATE INDEX idx_bc_sent_bc ON bc_sent (bc)",
        "CREATE INDEX idx_bc_sent_cust ON bc_sent (customer)",
      ],
    }));
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("bc_sent")); } catch (_) {}
});
