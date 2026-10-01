/// <reference path="../pb_data/types.d.ts" />
// Отдел заботы: менеджер звонит недовольному и записывает, чем закончилось.
// Без этого «взял в работу» ничего не говорит: непонятно, договорились или нет.
migrate((app) => {
  const c = app.findCollectionByNameOrId("reviews");
  if (!c.fields.getByName("handled_note")) c.fields.add(new Field({ name: "handled_note", type: "text", max: 2000 }));
  if (!c.fields.getByName("handled_at")) c.fields.add(new Field({ name: "handled_at", type: "text", max: 30 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("reviews");
  ["handled_note", "handled_at"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
