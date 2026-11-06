/// <reference path="../pb_data/types.d.ts" />
// Журнал доступности сайта. Нужен, чтобы отвечать на вопрос «как часто у нас
// не открывается» цифрой, а не ощущением: до сих пор мы знали об этом только
// со слов покупателей, а кто не загрузил страницу, тот и в счётчик не попал.
//
//   target — что проверяли: «сайт», «запасной вход», «оплата» и так далее
//   ok     — ответил ли
//   ms     — за сколько миллисекунд
//   code   — что ответил (0 — не достучались вовсе)
migrate((app) => {
  const c = new Collection({
    name: "uptime",
    type: "base",
    fields: [
      { name: "target", type: "text", max: 40, required: true },
      { name: "ok", type: "bool" },
      { name: "ms", type: "number" },
      { name: "code", type: "number" },
      { name: "note", type: "text", max: 200 },
      // Поля дат в новой коллекции не появляются сами — их надо объявить,
      // иначе индекс по created не создастся и сервер не стартует.
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE INDEX idx_uptime_at ON uptime (created)",
      "CREATE INDEX idx_uptime_target ON uptime (target, created)",
    ],
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("uptime"));
});
