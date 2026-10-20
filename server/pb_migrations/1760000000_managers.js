/// <reference path="../pb_data/types.d.ts" />
// Кабинет менеджеров: кто на линии, кто за какой заказ отвечает и кто что правил.
//
// Зачем. До сих пор у заказа не было хозяина: кто первый увидел, тот и отвечал,
// а если не ответил никто — выяснить это было не по чему. Владелец попросил
// три вещи: закреплять заказы за менеджерами, давать им править заказы, и
// видеть, кто, когда и что поменял.
//
//   managers.line     — «на линии» / «занят» / пусто. Заказы раздаются только
//                       тем, кто на линии: занятому новые не падают.
//   managers.seen_at  — последний признак жизни, админка отмечается сама.
//                       Зелёная точка — это он, а не кнопка: вкладка может
//                       висеть открытой, пока человек обедает.
//   managers.can_chat — доступ к диалогам, раздаёт владелец или руководитель.
//
//   orders.manager    — ответственный (id менеджера), orders.manager_at — когда
//                       назначен, orders.manager_how — «сам взял» или «автоматом».
//
//   order_log         — лента правок: кто, когда, что было и что стало.
//                       Отдельной таблицей, а не полем в заказе: поле затирается
//                       соседним сохранением из устаревшей копии — на этом уже
//                       обожглись с photo_file_id и order_notified.
migrate((app) => {
  const m = app.findCollectionByNameOrId("managers");
  const добавить = (c, f) => { if (!c.fields.getByName(f.name)) c.fields.add(new Field(f)); };
  добавить(m, { name: "line", type: "text", max: 10 });
  добавить(m, { name: "seen_at", type: "text", max: 40 });
  добавить(m, { name: "can_chat", type: "bool" });
  добавить(m, { name: "off", type: "bool" });          // отключён, вход закрыт
  app.save(m);

  const o = app.findCollectionByNameOrId("orders");
  добавить(o, { name: "manager", type: "text", max: 40 });
  добавить(o, { name: "manager_at", type: "text", max: 40 });
  добавить(o, { name: "manager_how", type: "text", max: 20 });
  app.save(o);

  // Лента правок. Пишется только серверным обработчиком — поэтому обойти её,
  // правя запись напрямую, не выйдет.
  try { app.findCollectionByNameOrId("order_log"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "order_log",
      listRule: '@request.auth.collectionName = "managers"',
      viewRule: '@request.auth.collectionName = "managers"',
      createRule: null, updateRule: null, deleteRule: null,   // пишет только сервер
      fields: [
        { name: "order", type: "text", max: 40, required: true },
        { name: "number", type: "number" },                   // номер заказа — искать глазами
        { name: "manager", type: "text", max: 40 },           // пусто — сделала система
        { name: "nick", type: "text", max: 40 },
        { name: "action", type: "text", max: 40, required: true },
        { name: "text", type: "text", max: 2000 },
        { name: "at", type: "text", max: 40 },
        { name: "created", type: "autodate", onCreate: true },
      ],
    }));
    app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_order_log_order ON order_log (`order`)").execute();
  }

  // Доплата. Своя табличка, а не поле в заказе: доплат может быть несколько,
  // и у каждой свой счёт в банке — повторять номер нельзя, иначе сверка кассы
  // увидит два платежа на один счёт (так вышло с №4371: 8578 вместо 4289).
  try { app.findCollectionByNameOrId("order_extras"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "order_extras",
      listRule: '@request.auth.collectionName = "managers"',
      viewRule: '@request.auth.collectionName = "managers"',
      createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "order", type: "text", max: 40, required: true },
        { name: "number", type: "number" },
        { name: "sum", type: "number", required: true },
        { name: "invoice", type: "text", max: 40 },           // v4371d1
        { name: "url", type: "text", max: 500 },
        { name: "paid_at", type: "text", max: 40 },
        { name: "ms_payment_id", type: "text", max: 60 },
        { name: "by", type: "text", max: 40 },
        { name: "created", type: "autodate", onCreate: true },
      ],
    }));
    app.db().newQuery("CREATE INDEX IF NOT EXISTS idx_order_extras_order ON order_extras (`order`)").execute();
  }
}, (app) => {
  const m = app.findCollectionByNameOrId("managers");
  ["line", "seen_at", "can_chat", "off"].forEach((n) => m.fields.removeByName(n));
  app.save(m);
  const o = app.findCollectionByNameOrId("orders");
  ["manager", "manager_at", "manager_how"].forEach((n) => o.fields.removeByName(n));
  app.save(o);
  try { app.delete(app.findCollectionByNameOrId("order_log")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("order_extras")); } catch (_) {}
});
