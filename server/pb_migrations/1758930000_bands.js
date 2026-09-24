/// <reference path="../pb_data/types.d.ts" />
// Пояса доставки внутри Москвы: цена зависит от того, за какое кольцо вышел адрес.
// Пояс — это кольцо и сколько километров снаружи от него он захватывает
// (0 — ровно внутри кольца). Проверяются по порядку, побеждает первый подходящий.
// Всё, что не попало ни в один пояс, считается по правилам «за МКАД».
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "bands", type: "json" }));
  app.save(s);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("bands", [
    { name: "Внутри Садового кольца", ring: "sadovoe", km: 0, price: 600 },
    { name: "Внутри Третьего кольца", ring: "ttk", km: 0, price: 690 },
    { name: "До 2 км за Третьим кольцом", ring: "ttk", km: 2, price: 749 },
    { name: "Внутри МКАД", ring: "mkad", km: 0, price: 799 },
  ]);
  app.save(rec);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("bands");
  app.save(s);
});
