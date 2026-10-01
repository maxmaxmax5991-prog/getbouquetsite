/// <reference path="../pb_data/types.d.ts" />
// Точное название номенклатуры в МоёмСкладе у товара. Раньше название собиралось
// само: приставка + имя товара на сайте (+ длина). Если на складе сорт называется
// иначе, оставался только подбор по словам, а он ошибается или не находит вовсе —
// так №3264 не уходил в склад.
// Заодно прописываем французские розы и сбрасываем у них старые привязки,
// чтобы они не перебивали новое название.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  if (!c.fields.getByName("ms_name")) c.fields.add(new Field({ name: "ms_name", type: "text", max: 200 }));
  app.save(c);

  const СКЛАД = {
    "Белые французские розы": "ЛФ- Французская Роза Мондиаль 60 см",
    "Розовые французские розы": "ЛФ- Французская Роза Пинк Мондиаль 60 см",
    "Красные французские розы": "ЛФ- Французская Роза Эксплорер 60 см",
  };
  Object.keys(СКЛАД).forEach((имя) => {
    let p = null;
    try { p = app.findFirstRecordByFilter("products", "name = {:n}", { n: имя }); } catch (_) {}
    if (!p) { console.log("ms_name: нет товара", имя); return; }
    p.set("ms_name", СКЛАД[имя]);
    p.set("ms_pick", null);   // старая привязка по id перебивала бы название
    p.set("ms_ids", "{}");    // и запомненные номера тоже
    app.save(p);
  });
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("ms_name");
  app.save(c);
});
