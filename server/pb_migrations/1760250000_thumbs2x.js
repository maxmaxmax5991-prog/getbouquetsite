/// <reference path="../pb_data/types.d.ts" />
// Разрешаем превью под экраны Retina: 1120 для карточки каталога, 1600 для
// страницы товара, 320 для миниатюр под снимком.
//
// ЗАЧЕМ МИГРАЦИЯ, А НЕ ПРОСТО ССЫЛКА. PocketBase отдаёт уменьшённую копию
// ТОЛЬКО для размеров, перечисленных в настройках поля. Размер, которого в
// списке нет, он молча отдаёт оригиналом — 3000 px и полтора мегабайта. Так и
// вышло 16.10: сайт попросил 1120, а покупателям поехали исходники. Поэтому
// любой новый размер в ссылках сайта обязан сначала появиться здесь.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  const было = f.thumbs || [];
  ["1120x0", "1600x0", "320x320"].forEach((t) => { if (было.indexOf(t) < 0) было.push(t); });
  f.thumbs = было;
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  const f = c.fields.getByName("photo");
  f.thumbs = (f.thumbs || []).filter((t) => ["1120x0", "1600x0", "320x320"].indexOf(t) < 0);
  app.save(c);
});
