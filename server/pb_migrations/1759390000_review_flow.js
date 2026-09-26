/// <reference path="../pb_data/types.d.ts" />
// Развилка после оценок: недовольного берёт менеджер, довольного зовём на Яндекс.Карты.
// Ссылку на карточку организации владелец вставляет в настройках.
migrate((app) => {
  const c = app.findCollectionByNameOrId("reviews");
  if (!c.fields.getByName("needs_call")) c.fields.add(new Field({ name: "needs_call", type: "bool" }));
  if (!c.fields.getByName("handled")) c.fields.add(new Field({ name: "handled", type: "bool" }));
  if (!c.fields.getByName("handled_by")) c.fields.add(new Field({ name: "handled_by", type: "text", max: 120 }));
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("review_url")) s.fields.add(new Field({ name: "review_url", type: "text", max: 300 }));
  app.save(s);
}, (app) => {
  const c = app.findCollectionByNameOrId("reviews");
  ["needs_call", "handled", "handled_by"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("review_url");
  app.save(s);
});
