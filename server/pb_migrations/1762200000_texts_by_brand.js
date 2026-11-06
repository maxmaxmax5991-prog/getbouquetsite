/// <reference path="../pb_data/types.d.ts" />
// Тексты по витринам. Один каталог продают три домена, и одинаковые описания
// на всех трёх — это дубли: поисковик выбирает один адрес, два других прячет.
// Сайты начинают конкурировать сами с собой.
//
// Храним так: {"<id витрины>": {"t": заголовок, "m": мета-описание,
// "d": описание товара, "x": текст раздела}}. Чего нет — берётся общее поле,
// как и раньше: витрине, которой текст не писали, ничего не ломается.
migrate((app) => {
  const p = app.findCollectionByNameOrId("products");
  if (!p.fields.getByName("texts_by")) p.fields.add(new Field({ name: "texts_by", type: "json", maxSize: 2000000 }));
  app.save(p);
  const c = app.findCollectionByNameOrId("categories");
  if (!c.fields.getByName("texts_by")) c.fields.add(new Field({ name: "texts_by", type: "json", maxSize: 2000000 }));
  app.save(c);
}, (app) => {
  const p = app.findCollectionByNameOrId("products");
  p.fields.removeByName("texts_by");
  app.save(p);
  const c = app.findCollectionByNameOrId("categories");
  c.fields.removeByName("texts_by");
  app.save(c);
});
