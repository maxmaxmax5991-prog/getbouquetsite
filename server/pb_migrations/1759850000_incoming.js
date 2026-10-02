/// <reference path="../pb_data/types.d.ts" />
// «В пути» по-человечески: привоз хранится отдельно от остатка и по каждой длине.
//   stock    = {"60": 2100}                          — что лежит в холодильнике сейчас
//   incoming = {"60": {"qty": 600, "at": "2026-10-02 16:00"}} — что едет и когда будет
// Раньше время привоза было одно на весь сорт (products.ready_at), и стоило его
// проставить, как сайт переставал предлагать раннюю доставку даже для того, что
// уже есть. Теперь ограничение включается только когда размера не хватает без привоза.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("incoming")) c.fields.add(new Field({ name: "incoming", type: "json", maxSize: 4000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("incoming");
  app.save(c);
});
