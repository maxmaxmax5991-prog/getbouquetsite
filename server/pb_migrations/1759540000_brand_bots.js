/// <reference path="../pb_data/types.d.ts" />
// У каждой витрины свой бот для покупателей — и в Телеграме, и в MAX.
// Позицию чтения тоже держим у витрины: иначе два бота мешали бы друг другу.
migrate((app) => {
  const c = app.findCollectionByNameOrId("brands");
  const add = (name, type) => { if (!c.fields.getByName(name)) c.fields.add(new Field({ name, type })); };
  add("max_token", "text");
  add("max_bot", "text");
  add("max_link", "text");        // «Написать в MAX» в подвале
  add("tg_offset", "number");     // позиция чтения Телеграма
  add("max_marker", "number");    // позиция чтения MAX
  app.save(c);

  // Первой витрине отдаём то, что уже настроено в общих настройках
  try {
    const s = app.findFirstRecordByFilter("settings", "id != ''");
    const v = app.findFirstRecordByFilter("brands", "slug = 'venikoff'");
    if (!v.get("tg_client_token")) v.set("tg_client_token", s.get("tg_client_token") || "");
    if (!v.get("tg_client_bot")) v.set("tg_client_bot", s.get("tg_client_bot") || "");
    v.set("max_token", s.get("max_token") || "");
    v.set("max_bot", s.get("max_bot") || "");
    v.set("tg_offset", s.get("tg_offset_client") || 0);
    v.set("max_marker", s.get("max_marker") || 0);
    app.save(v);
  } catch (err) { console.log("brand bots seed", err); }
}, (app) => {
  const c = app.findCollectionByNameOrId("brands");
  ["max_token", "max_bot", "max_link", "tg_offset", "max_marker"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
