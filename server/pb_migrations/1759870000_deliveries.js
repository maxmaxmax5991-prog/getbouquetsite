/// <reference path="../pb_data/types.d.ts" />
// Поставки накладными. Раньше «в пути» было россыпью строк по сортам, и чтобы
// отметить приход, приходилось жать кнопку у каждой. Теперь накладная — один
// документ: поставщик, время привоза и список строк. Пришла машина — одна кнопка.
// products.incoming пересчитывается из открытых накладных, поэтому вся продажная
// логика остаётся прежней и ничего про накладные не знает.
migrate((app) => {
  const MANAGER = '@request.auth.collectionName = "managers"';
  const c = new Collection({
    type: "base",
    name: "deliveries",
    listRule: MANAGER, viewRule: MANAGER, createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
    fields: [
      { name: "supplier", type: "text", max: 120, required: true },
      { name: "at", type: "text", max: 20 },        // ГГГГ-ММ-ДД ЧЧ:ММ — когда будет
      { name: "lines", type: "json", maxSize: 60000 },   // [{product, name, len, qty}]
      { name: "note", type: "text", max: 300 },
      { name: "done", type: "bool" },
      { name: "done_at", type: "text", max: 30 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_deliveries_done ON deliveries (done, at)"],
  });
  app.save(c);
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("deliveries")); } catch (_) {}
});
