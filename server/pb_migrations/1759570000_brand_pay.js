/// <reference path="../pb_data/types.d.ts" />
// Свой терминал CloudPayments у каждой витрины: это разные магазины,
// и деньги должны приходить каждому на свой, иначе выписку не разобрать.
// Ключей нет — витрина работает на общих из настроек.
migrate((app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["cp_public_id", "cp_secret"].forEach((n) => {
    if (!c.fields.getByName(n)) c.fields.add(new Field({ name: n, type: "text" }));
  });
  app.save(c);

  // первой витрине отдаём то, что уже настроено
  try {
    const s = app.findFirstRecordByFilter("settings", "id != ''");
    const v = app.findFirstRecordByFilter("brands", "slug = 'venikoff'");
    v.set("cp_public_id", s.get("cp_public_id") || "");
    v.set("cp_secret", s.get("cp_secret") || "");
    app.save(v);
  } catch (err) { console.log("brand pay seed", err); }
}, (app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["cp_public_id", "cp_secret"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
