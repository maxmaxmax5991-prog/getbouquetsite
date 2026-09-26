/// <reference path="../pb_data/types.d.ts" />
// Рассылки. Кроме своего клиентского бота и MAX можно подключить сколько угодно
// других Телеграм-ботов — просто по ключу от @BotFather.
//
// Телеграм не отдаёт список подписчиков бота: мы знаем только тех, кто написал боту
// или нажал «Старт». Поэтому подключённые боты опрашиваются, и каждый, кто им пишет,
// попадает в bc_subs. Старую базу из другого сервиса можно загрузить списком номеров (ID).
migrate((app) => {
  const bots = new Collection({
    name: "bc_bots",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "token", type: "text", max: 200, required: true },
      { name: "username", type: "text", max: 120 },
      { name: "title", type: "text", max: 200 },
      { name: "active", type: "bool" },          // собирать подписчиков и слать рассылки
      { name: "hello", type: "text", max: 2000 }, // ответ на /start (пусто — молчим)
      { name: "offset", type: "number" },
      { name: "error", type: "text", max: 500 },  // что мешает опросу (например, webhook другого сервиса)
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bc_bots_token ON bc_bots (token)"],
  });
  app.save(bots);

  const subs = new Collection({
    name: "bc_subs",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "bot", type: "relation", collectionId: app.findCollectionByNameOrId("bc_bots").id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: "chat", type: "text", max: 40, required: true },
      { name: "name", type: "text", max: 200 },
      { name: "username", type: "text", max: 120 },
      { name: "blocked", type: "bool" },          // остановил бота — больше не пишем
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_bc_subs ON bc_subs (bot, chat)"],
  });
  app.save(subs);

  const bc = new Collection({
    name: "broadcasts",
    type: "base",
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
    fields: [
      { name: "text", type: "text", max: 4096 },
      { name: "photo", type: "file", maxSelect: 1, maxSize: 20 << 20, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      { name: "button_text", type: "text", max: 60 },
      { name: "button_url", type: "text", max: 1000 },
      { name: "targets", type: "json" },            // ["client", "max", "<id бота>", ...]
      { name: "status", type: "select", maxSelect: 1, values: ["queued", "sending", "done", "stopped"] },
      { name: "total", type: "number" },
      { name: "sent", type: "number" },
      { name: "failed", type: "number" },
      { name: "cursor", type: "json" },             // докуда дошли: { i: номер источника, last: id последнего }
      { name: "author", type: "text", max: 200 },
      { name: "finished", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
  });
  app.save(bc);
}, (app) => {
  ["broadcasts", "bc_subs", "bc_bots"].forEach((n) => {
    try { app.delete(app.findCollectionByNameOrId(n)); } catch (_) {}
  });
});
