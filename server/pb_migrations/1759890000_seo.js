/// <reference path="../pb_data/types.d.ts" />
// Настоящие адреса страниц для поисковиков.
//
// Зачем. Витрина жила на адресах вида /#/p/<id>: всё, что после «#», Яндекс и
// Google отдельной страницей не считают. Для них у каждого сайта была одна
// страница с одним заголовком — ни товары, ни разделы в поиск не попадали.
// И переезд lasflore.ru с Битрикса без этого потерял бы его индексацию.
//
//   products.slug                — адрес товара: /catalog/<раздел>/<slug>/
//   categories.seo_*             — заголовок, описание и текст раздела для поиска
//   brands.seo_*                 — заголовок и описание главной у каждой витрины
//   redirects                    — старый адрес → новый (301), по витринам
migrate((app) => {
  const add = (c, f) => { if (!c.fields.getByName(f.name)) c.fields.add(new Field(f)); };

  const p = app.findCollectionByNameOrId("products");
  add(p, { name: "slug", type: "text", max: 120 });
  add(p, { name: "seo_title", type: "text", max: 200 });
  add(p, { name: "seo_description", type: "text", max: 400 });
  app.save(p);

  const c = app.findCollectionByNameOrId("categories");
  add(c, { name: "seo_title", type: "text", max: 200 });
  add(c, { name: "seo_description", type: "text", max: 400 });
  add(c, { name: "seo_text", type: "text", max: 5000 });
  app.save(c);

  const b = app.findCollectionByNameOrId("brands");
  add(b, { name: "seo_title", type: "text", max: 200 });
  add(b, { name: "seo_description", type: "text", max: 400 });
  app.save(b);

  let r = null;
  try { r = app.findCollectionByNameOrId("redirects"); } catch (_) {}
  if (!r) {
    const MANAGER = '@request.auth.collectionName = "managers"';
    r = new Collection({
      type: "base",
      name: "redirects",
      listRule: MANAGER, viewRule: MANAGER, createRule: MANAGER, updateRule: MANAGER, deleteRule: MANAGER,
      fields: [
        { name: "from", type: "text", required: true, max: 500 },   // путь старого сайта: /catalog/korziny/
        { name: "to", type: "text", max: 500 },                     // куда вести; пусто — на главную
        { name: "brand", type: "relation", collectionId: b.id, maxSelect: 1, cascadeDelete: true },
        { name: "hits", type: "number", min: 0 },                   // сколько раз сработал
        { name: "note", type: "text", max: 300 },
      ],
      indexes: ["CREATE INDEX idx_redirects_from ON redirects (`from`)"],
    });
    app.save(r);
  }

  // Адреса уже заведённым товарам. Транслит повторяет lib/slug.js — в миграции его не подключить.
  const MAP = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
  const make = (n) => String(n || "").toLowerCase().split("").map((ch) => (MAP[ch] !== undefined ? MAP[ch] : ch)).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "tovar";
  const used = {};
  const all = app.findRecordsByFilter("products", "id != ''", "created", 5000, 0);
  all.forEach((x) => { if (x.get("slug")) used[x.get("slug")] = 1; });
  all.forEach((x) => {
    if (x.get("slug")) return;
    const base = make(x.get("name"));
    let s = base, i = 2;
    while (used[s]) s = `${base}-${i++}`;
    used[s] = 1;
    // запросом, мимо хуков: сохранение товара тянет за собой МойСклад и вырезку фона
    app.db().newQuery("UPDATE products SET slug = {:s} WHERE id = {:id}").bind({ s, id: x.id }).execute();
  });
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  ["slug", "seo_title", "seo_description"].forEach((n) => p.fields.removeByName(n));
  app.save(p);
  const c = app.findCollectionByNameOrId("categories");
  ["seo_title", "seo_description", "seo_text"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
  const b = app.findCollectionByNameOrId("brands");
  ["seo_title", "seo_description"].forEach((n) => b.fields.removeByName(n));
  app.save(b);
  try { app.delete(app.findCollectionByNameOrId("redirects")); } catch (_) {}
});
