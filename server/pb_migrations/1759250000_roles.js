/// <reference path="../pb_data/types.d.ts" />
// Роли сотрудников.
//   owner   — владелец: всё;
//   head    — управляющий: как менеджер + остатки и «в пути»;
//   manager — менеджер: чаты, заказы, замена сорта в заказе. Больше ничего.
//
// Права проверяются в двух местах: в наших маршрутах (по роли) и в правилах
// коллекций — иначе менеджер мог бы править товары и настройки напрямую через API.
migrate((app) => {
  const m = app.findCollectionByNameOrId("managers");
  if (!m.fields.getByName("role")) {
    m.fields.add(new Field({ name: "role", type: "select", maxSelect: 1, values: ["owner", "head", "manager"] }));
  }
  app.save(m);
  // кто уже заведён — владелец
  app.db().newQuery("UPDATE managers SET role = 'owner' WHERE role IS NULL OR role = ''").execute();

  // товары, разделы и настройки — только владелец
  const onlyOwner = '@request.auth.collectionName = "managers" && @request.auth.role = "owner"';
  ["products", "categories"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    c.createRule = onlyOwner; c.updateRule = onlyOwner; c.deleteRule = onlyOwner;
    app.save(c);
  });
  const st = app.findCollectionByNameOrId("settings");
  st.updateRule = onlyOwner;
  app.save(st);
}, (app) => {
  const any = '@request.auth.collectionName = "managers"';
  ["products", "categories"].forEach((n) => {
    const c = app.findCollectionByNameOrId(n);
    c.createRule = any; c.updateRule = any; c.deleteRule = any;
    app.save(c);
  });
  const st = app.findCollectionByNameOrId("settings");
  st.updateRule = any;
  app.save(st);
  const m = app.findCollectionByNameOrId("managers");
  m.fields.removeByName("role");
  app.save(m);
});
