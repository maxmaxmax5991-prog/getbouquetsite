/// <reference path="../pb_data/types.d.ts" />
// Шаблоны быстрых ответов в чате. Менеджеры целый день пишут одно и то же:
// про сроки доставки, про замену сорта, про оплату. Шаблоны общие на всех —
// в этом и смысл: ответ, который один раз сформулировали правильно, должны
// отправлять все одинаково. Поэтому заводить и править может любой менеджер,
// а не только владелец: иначе шаблоны просто не появятся.
//
// Текст не рассылается никуда сам по себе — менеджер вставляет его в поле
// ответа и может дописать. Это ровно заготовка, а не автоответчик.
const MANAGER = '@request.auth.collectionName = "managers"';
migrate((app) => {
  try { app.findCollectionByNameOrId("quick_replies"); return; } catch (_) {}
  app.save(new Collection({
    type: "base",
    name: "quick_replies",
    listRule: MANAGER, viewRule: MANAGER,
    createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "title", type: "text", max: 60, required: true },  // как шаблон называется в списке
      { name: "text", type: "text", max: 2000, required: true }, // что подставится в поле ответа
      { name: "sort", type: "number" },                          // порядок кнопок
      { name: "author", type: "text", max: 120 },                // кто завёл — чтобы было с кого спросить
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_quick_sort ON quick_replies (sort)"],
  }));
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("quick_replies")); } catch (_) {}
});
