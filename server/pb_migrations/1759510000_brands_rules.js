/// <reference path="../pb_data/types.d.ts" />
// Справочник витрин я закрыл наглухо — и админка под управляющим его не увидела.
// Открываем на чтение и правку менеджерам: там нет ничего секретного, кроме
// ключа клиентского бота, а он и так виден только вошедшему в админку.
migrate((app) => {
  const MANAGER = '@request.auth.collectionName = "managers"';
  const c = app.findCollectionByNameOrId("brands");
  c.listRule = MANAGER;
  c.viewRule = MANAGER;
  c.createRule = MANAGER;
  c.updateRule = MANAGER;
  c.deleteRule = MANAGER;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("brands");
  c.listRule = null; c.viewRule = null; c.createRule = null; c.updateRule = null; c.deleteRule = null;
  app.save(c);
});
