/// <reference path="../pb_data/types.d.ts" />
// Интеграция с МоимСкладом: заказы с сайта уходят в «Заказы покупателей».
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  [["ms_token", "text"], ["ms_org_id", "text"], ["ms_org_name", "text"],
   ["ms_store_id", "text"], ["ms_store_name", "text"]].forEach(([name, type]) => s.fields.add(new Field({ name, type })));
  s.fields.add(new Field({ name: "ms_enabled", type: "bool" }));
  app.save(s);

  const o = app.findCollectionByNameOrId("orders");
  o.fields.add(new Field({ name: "ms_id", type: "text" }));       // id заказа в МоёмСкладе
  o.fields.add(new Field({ name: "ms_error", type: "text" }));     // почему не ушёл
  app.save(o);

  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "ms_id", type: "text" }));        // id товара в МоёмСкладе
  app.save(p);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["ms_token", "ms_org_id", "ms_org_name", "ms_store_id", "ms_store_name", "ms_enabled"].forEach((f) => s.fields.removeByName(f));
  app.save(s);
  const o = app.findCollectionByNameOrId("orders");
  ["ms_id", "ms_error"].forEach((f) => o.fields.removeByName(f));
  app.save(o);
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("ms_id");
  app.save(p);
});
