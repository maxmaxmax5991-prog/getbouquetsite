/// <reference path="../pb_data/types.d.ts" />
// Вырезаем фон у первого фото товара — картинка для карусели на главной.
// Считает нейросеть (rembg, модель u2net) прямо на сервере: ~7 секунд и до 900 МБ
// памяти на снимок, поэтому берём строго по одному товару за раз, раз в минуту.
// Владельцу готовить PNG вручную больше не нужно.

// Снимки с айфона (HEIC) переводим в JPEG: сам PocketBase их не уменьшает,
// и на сайте вместо фото была бы пустота. Делаем это раньше вырезки фона.
cronAdd("heic-convert", "* * * * *", () => {
  const PY = "/opt/venikoff/bg/bin/python";
  const SCRIPT = "/opt/venikoff/bin/tojpg.py";
  const isHeic = (n) => /\.(heic|heif)$/i.test(String(n));

  const list = $app.findRecordsByFilter("products", "id != ''", "-created", 200, 0)
    .filter((r) => (r.get("photo") || []).some(isHeic));
  if (!list.length) return;

  const rec = list[0];
  const photos = rec.get("photo") || [];
  const dir = `${$app.dataDir()}/storage/${rec.collection().id}/${rec.id}`;
  let changed = false;
  const temps = [];

  const переведённые = [];        // старые имена: по ним перенесём подписи после сохранения

  photos.forEach((name) => {
    if (!isHeic(name)) return;
    const dst = `${$app.dataDir()}/../${String(name).replace(/\.(heic|heif)$/i, "")}.jpg`;
    try {
      console.log("перевод в JPEG", name, toString($os.cmd(PY, SCRIPT, `${dir}/${name}`, dst).output()).trim());
      rec.set("photo+", $filesystem.fileFromPath(dst));
      rec.set("photo-", name);
      переведённые.push(name);
      temps.push(dst);              // удалим после сохранения: до него файл ещё нужен
      changed = true;
    } catch (err) {
      console.log("не перевёлся", name, err);
      rec.set("photo-", name);      // битый файл просто убираем, иначе задание зациклится
      changed = true;
    }
  });

  if (changed) { try { $app.save(rec); } catch (err) { console.log("heic save", err); } }

  // ПОДПИСЬ ПРИВЯЗАНА К ИМЕНИ ФАЙЛА, А ИМЯ ПОСЛЕ ПЕРЕВОДА МЕНЯЕТСЯ.
  // `photo_counts` — это карта «имя файла → сколько цветов на снимке». Пока
  // снимок переводился из HEIC в JPEG, ключ оставался на старом имени, и
  // подпись пропадала молча. 16.10 так потерялись подписи у одиннадцати
  // снимков, в том числе у розовых французских роз — все три.
  // Новое имя это старое плюс суффикс, поэтому сопоставляем по началу.
  // Пишем запросом, мимо хуков: второе сохранение подряд той же записи —
  // отдельная грабля, см. CLAUDE.md.
  if (переведённые.length) {
    try {
      const файлы = rec.get("photo") || [];
      let подписи = {};
      try { подписи = JSON.parse(rec.getString("photo_counts") || "{}") || {}; } catch (_) { подписи = {}; }
      let сдвиг = false;
      переведённые.forEach((старое) => {
        if (подписи[старое] === undefined) return;
        const основа = String(старое).replace(/\.[^.]+$/, "");
        const новое = файлы.find((x) => String(x).indexOf(основа + "_") === 0 && подписи[x] === undefined);
        if (!новое) return;
        подписи[новое] = подписи[старое];
        delete подписи[старое];
        сдвиг = true;
      });
      if (сдвиг) {
        $app.db().newQuery("UPDATE products SET photo_counts = {:v} WHERE id = {:id}")
          .bind({ v: JSON.stringify(подписи), id: rec.id }).execute();
        console.log("подписи снимков перенесены на новые имена", rec.get("name"));
      }
    } catch (err) { console.log("подписи после перевода", err); }
  }

  temps.forEach((f) => { try { $os.remove(f); } catch (_) {} });
});

cronAdd("cutout", "* * * * *", () => {

  const shop = require(`${__hooks}/lib/shop.js`);
  const PY = "/opt/venikoff/bg/bin/python";
  const SCRIPT = "/opt/venikoff/bin/cutout.py";

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  if (!s.get("auto_cut")) return;

  const list = $app.findRecordsByFilter("products", "cut_done != true", "-created", 1, 0);
  if (!list.length) return;
  const rec = list[0];

  const photos = rec.get("photo") || [];
  if (!photos.length) { rec.set("cut_done", true); $app.save(rec); return; }
  if (/\.(heic|heif)$/i.test(String(photos[0]))) return;   // подождём, пока снимок переведут в JPEG

  // фото лежит на диске: <данные>/storage/<коллекция>/<запись>/<файл>
  const src = `${$app.dataDir()}/storage/${rec.collection().id}/${rec.id}/${photos[0]}`;
  const dst = `${$app.dataDir()}/../cut-${rec.id}.webp`;   // WebP с прозрачностью весит впятеро меньше PNG

  try {
    const out = toString($os.cmd(PY, SCRIPT, src, dst).output());
    console.log("вырезка", rec.get("name"), out.trim());
    rec.set("cutout", $filesystem.fileFromPath(dst));
    rec.set("cut_done", true);
    $app.save(rec);
  } catch (err) {
    console.log("вырезка не вышла", rec.get("name"), err); require(`${__hooks}/lib/err.js`).note($app, "Вырезка фона", String(err), rec.get("name"));
    rec.set("cut_done", true);   // второй раз не пробуем, чтобы не крутиться вечно
    try { $app.save(rec); } catch (_) {}
  }
  try { $os.remove(dst); } catch (_) {}
});

// Если у товара поменялись фото — вырезку для карусели надо сделать заново.
// Без этого товар, заведённый без фото, помечался «вырезано» (резать было нечего),
// а после загрузки снимка в карусель уже не попадал.
// Отметку снимаем запросом, мимо хуков, чтобы не разбудить этот же обработчик.
onRecordAfterUpdateSuccess((e) => {
  try {
    const now = JSON.stringify(e.record.get("photo") || []);
    const was = JSON.stringify(e.record.original().get("photo") || []);
    if (now !== was) {
      $app.db().newQuery("UPDATE products SET cut_done = false WHERE id = {:id}").bind({ id: e.record.id }).execute();
    }
  } catch (err) { console.log("сброс вырезки", err); }
  e.next();
}, "products");
