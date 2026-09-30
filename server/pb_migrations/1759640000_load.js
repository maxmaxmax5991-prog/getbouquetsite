/// <reference path="../pb_data/types.d.ts" />
// «Высокая нагрузка»: одной кнопкой добавить время на сборку всем заказам.
// В запару флористы не успевают к обычным 45 минутам, и сайт продолжал обещать
// покупателям ближайший интервал. Теперь к сборке прибавляются лишние минуты —
// ближайшее окно доставки само сдвигается вперёд, и на сайте, и при проверке заказа.
// load_until — до какого момента режим держится: чтобы его не забыли выключить
// на ночь и утром сайт снова считал по-обычному.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("load_extra")) s.fields.add(new Field({ name: "load_extra", type: "number", min: 0, max: 600 }));
  if (!s.fields.getByName("load_until")) s.fields.add(new Field({ name: "load_until", type: "text", max: 30 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  ["load_extra", "load_until"].forEach((n) => s.fields.removeByName(n));
  app.save(s);
});
