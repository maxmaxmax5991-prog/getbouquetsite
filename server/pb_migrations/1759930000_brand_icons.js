/// <reference path="../pb_data/types.d.ts" />
// Своя иконка у витрины: во вкладке браузера (favicon) и на экране «Домой»
// телефона (touch_icon, PNG 180×180 — айфон SVG там не берёт).
// Пусто — остаётся иконка venikoff из index.html.
// LasFlore и «Гет Букет» получают свои сразу: файлы лежат в img/brand,
// выкладка кладёт их туда раньше, чем перезапускается сервер.
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  const add = (f) => { if (!b.fields.getByName(f.name)) b.fields.add(new Field(f)); };
  add({ name: "favicon", type: "file", maxSelect: 1, maxSize: 524288, mimeTypes: ["image/svg+xml", "image/png", "image/x-icon", "image/vnd.microsoft.icon"] });
  add({ name: "touch_icon", type: "file", maxSelect: 1, maxSize: 1048576, mimeTypes: ["image/png"] });
  app.save(b);

  const dir = $os.getenv("VENIKOFF_SITE") || "/opt/venikoff/site";
  [["lasflore", "lasflore"], ["get", "get"]].forEach(([slug, file]) => {
    let r = null;
    try { r = app.findFirstRecordByFilter("brands", "slug = {:s}", { s: slug }); } catch (_) {}
    if (!r || r.get("favicon")) return;
    try {
      r.set("favicon", $filesystem.fileFromPath(`${dir}/img/brand/${file}-icon.svg`));
      r.set("touch_icon", $filesystem.fileFromPath(`${dir}/img/brand/${file}-touch.png`));
      app.save(r);
    } catch (err) { console.log("brand icon", slug, err); }
  });
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  ["favicon", "touch_icon"].forEach((n) => b.fields.removeByName(n));
  app.save(b);
});
