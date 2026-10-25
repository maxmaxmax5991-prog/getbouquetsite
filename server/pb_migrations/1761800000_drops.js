/// <reference path="../pb_data/types.d.ts" />
// Дроп дня: 101 роза 40 см за 5 990 ₽, ограниченное число букетов, старт в 12:00.
//
// Смысл не в скидке, а в дефиците: цена обычная, но букетов на день мало, и
// разбирают их за минуты. Поэтому здесь очередь: человек встаёт в неё заранее,
// в 12:00 первым раздаются букеты (по одному в руки за сутки), на оплату 15
// минут. Не успел — букет уходит следующему, а сам он ждёт завтрашнего дропа.
//
// Состав владелец назначает каждое утро. Время «доставляем с» — одно на весь
// дроп: цветы приезжают днём, и раньше этого часа обещать доставку нельзя.
const OWNER = '@request.auth.collectionName = "managers" && @request.auth.role = "owner"';
migrate((app) => {
  try { app.findCollectionByNameOrId("drops"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "drops",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "date", type: "text", max: 10 },        // 2026-10-26, день дропа
        { name: "start_at", type: "text", max: 16 },    // 2026-10-26 12:00 — старт продаж, МСК
        { name: "ready_at", type: "text", max: 16 },    // 2026-10-26 15:00 — доставляем с
        { name: "len", type: "number" },                // ростовка, 40
        { name: "cnt", type: "number" },                // роз в букете, 101
        { name: "price", type: "number" },              // цена букета
        { name: "lots", type: "json", maxSize: 20000 }, // [{product, qty, left}]
        { name: "active", type: "bool" },               // опубликован на сайте
        { name: "note", type: "text", max: 300 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: ["CREATE UNIQUE INDEX idx_drops_date ON drops (date)"],
    }));
  }
  try { app.findCollectionByNameOrId("drop_queue"); } catch (_) {
    app.save(new Collection({
      type: "base",
      name: "drop_queue",
      listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
      fields: [
        { name: "drop", type: "text", max: 40 },
        { name: "customer", type: "text", max: 40 },
        { name: "chat", type: "text", max: 40 },        // чат в Телеграме: туда зовём
        { name: "brand", type: "text", max: 40 },       // с какой витрины пришёл: её ботом и зовём
        { name: "name", type: "text", max: 120 },
        { name: "phone", type: "text", max: 40 },
        { name: "place", type: "number" },              // место в очереди
        // waiting — ждёт, invited — позвали и держим букет, paid — оплатил,
        // missed — не успел за 15 минут, out — букетов не хватило
        { name: "status", type: "text", max: 10 },
        { name: "product", type: "text", max: 40 },     // какой сорт выдали
        { name: "invited_at", type: "text", max: 25 },
        { name: "expires_at", type: "text", max: 25 },
        { name: "order", type: "text", max: 40 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [
        "CREATE INDEX idx_dq_drop ON drop_queue (drop)",
        "CREATE INDEX idx_dq_cust ON drop_queue (customer)",
        "CREATE UNIQUE INDEX idx_dq_once ON drop_queue (drop, customer)",
      ],
    }));
  }
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("drop_queue")); } catch (_) {}
  try { app.delete(app.findCollectionByNameOrId("drops")); } catch (_) {}
});
