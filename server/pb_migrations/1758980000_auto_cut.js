/// <reference path="../pb_data/types.d.ts" />
// Автоматическая вырезка фона для карусели: раньше владелец делал её вручную
// на своём компьютере. Теперь фон снимает сервер (rembg, модель u2net),
// поэтому достаточно загрузить обычное фото.
// cut_done — чтобы не пытаться бесконечно на снимке, с которым не вышло.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.add(new Field({ name: "auto_cut", type: "bool" }));
  app.save(s);

  const p = app.findCollectionByNameOrId("products");
  p.fields.add(new Field({ name: "cut_done", type: "bool" }));
  app.save(p);

  const rec = app.findFirstRecordByFilter("settings", "id != ''");
  rec.set("auto_cut", true);
  app.save(rec);

  // у кого вырезка уже есть — второй раз не трогаем
  app.findRecordsByFilter("products", "cutout != ''", "", 500, 0).forEach((r) => {
    r.set("cut_done", true);
    app.save(r);
  });
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("auto_cut");
  app.save(s);
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("cut_done");
  app.save(p);
});
