/// <reference path="../pb_data/types.d.ts" />
// Загрузка товаров по отдельной ссылке — для управляющей.
// Вход по ключу из ссылки, а не по логину: аккаунт заводить не нужно,
// в заказы и настройки такая ссылка не пускает. Всё, что можно сделать, —
// добавить товар с фото, поправить цену и убрать товар с сайта.

// Что показать на странице: разделы, прайсы и последние добавленные товары
routerAdd("GET", "/api/shop/upload-meta", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  const key = s.get("upload_key");
  if (!key || e.request.url.query().get("k") !== key) return e.json(403, { message: "Ссылка недействительна. Попросите новую." });

  const cats = $app.findRecordsByFilter("categories", "active = true", "sort", 100, 0)
    .map((c) => ({ id: c.id, name: c.get("name"), addon: !!c.get("addon") }));
  const tables = shop.priceTables(s).map((t) => ({ id: t.id, name: t.name }));
  const recent = $app.findRecordsByFilter("products", "id != ''", "-created", 20, 0).map((p) => {
    const photos = p.get("photo") || [];
    return {
      id: p.id,
      name: p.get("name"),
      price: p.get("price") || 0,
      active: !!p.get("active"),
      lengths: shop.jget(p, "lengths") || null,
      img: photos.length ? shop.fileUrl(p, photos[0], "160x160") : "",
      cut: p.get("cutout") ? shop.fileUrl(p, p.get("cutout")) : "",
    };
  });
  return e.json(200, { categories: cats, tables, recent });
});

// Добавить товар: фото + название + раздел + цена
routerAdd("POST", "/api/shop/upload", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  const key = s.get("upload_key");

  e.request.parseMultipartForm(40 << 20);   // фото с телефона бывают тяжёлыми
  const form = e.request.multipartForm;
  const val = (n) => { const v = form.value[n]; return v && v.length ? String(v[0]).trim() : ""; };
  if (!key || val("k") !== key) return e.json(403, { message: "Ссылка недействительна. Попросите новую." });

  const name = val("name").slice(0, 200);
  const category = val("category");
  if (!name) return e.json(400, { message: "Напишите название букета." });
  if (!category) return e.json(400, { message: "Выберите раздел." });

  const files = (form.file["photo"] || []).slice(0, 5).map((fh) => $filesystem.fileFromMultipart(fh));
  if (!files.length) return e.json(400, { message: "Добавьте хотя бы одно фото." });

  const lens = val("lengths").split(",").map((x) => +x).filter((x) => x > 0);
  const price = +val("price") || 0;
  if (!lens.length && !price) return e.json(400, { message: "Укажите цену." });

  const col = $app.findCollectionByNameOrId("products");
  const rec = new Record(col);
  rec.set("name", name);
  rec.set("category", category);
  rec.set("description", val("description").slice(0, 2000));
  rec.set("photo", files);
  rec.set("active", true);
  if (lens.length) {
    rec.set("lengths", lens);                        // одноголовые розы: цена придёт из прайса
    rec.set("price_table", val("table") || "single");
  } else {
    rec.set("price", price);
  }
  const last = $app.findRecordsByFilter("products", "id != ''", "-sort", 1, 0);
  rec.set("sort", last.length ? (last[0].get("sort") || 0) + 1 : 1);
  $app.save(rec);

  // фон для карусели вырежем отдельным заданием — оно ходит раз в минуту
  return e.json(200, { ok: true, id: rec.id, name });
});

// Поправить цену или убрать товар с сайта — то немногое, что можно по ссылке
routerAdd("POST", "/api/shop/upload-fix", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const s = shop.settings($app);
  const key = s.get("upload_key");
  const b = e.requestInfo().body || {};
  if (!key || String(b.k || "") !== key) return e.json(403, { message: "Ссылка недействительна. Попросите новую." });

  let rec;
  try { rec = $app.findRecordById("products", String(b.id || "")); } catch (_) { return e.json(404, { message: "Товар не найден." }); }
  if (b.price != null && +b.price >= 0) rec.set("price", +b.price);
  if (b.active != null) rec.set("active", !!b.active);
  $app.save(rec);
  return e.json(200, { ok: true });
});
