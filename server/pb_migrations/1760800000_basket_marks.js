/// <reference path="../pb_data/types.d.ts" />
// Отметки на бегунке — свои у каждой категории.
//
// Вместимость меряется в «местах» (одноголовая = 1, кустовая = 2, гортензия =
// 3), но покупателю надо показывать штуки и круглые: у одноголовых привычны
// 101/151/251, у кустовых — 51/75/101. Вычислять их делением вместимости
// бессмысленно: выходят 125 и 83, которые никто не просит.
//
// Поэтому держим список отметок у раздела и даём править: что считать красивым
// числом, решает владелец, а не формула.
migrate((app) => {
  const c = app.findCollectionByNameOrId("categories");
  if (!c.fields.getByName("basket_marks")) c.fields.add(new Field({ name: "basket_marks", type: "text", max: 200 }));
  app.save(c);

  const ОТМЕТКИ = {
    "single": "101,151,201,251,501,1001",
    "ecuador-premium": "101,151,201,251,501,1001",
    "kenya": "101,151,201,251,501,1001",
    "french": "51,75,101,151,251,501",
    "kustovye-rozy": "51,75,101,151,251,501",
    "kustovye-rozy-pionovidnye": "51,75,101,151,251,501",
    "hydrangea": "25,35,51,75,101,151",
  };
  let все = [];
  try { все = app.findRecordsByFilter("categories", "id != ''", "sort", 100, 0); } catch (_) {}
  все.forEach((x) => {
    const m = ОТМЕТКИ[String(x.get("slug") || "")];
    if (!m) return;
    app.db().newQuery("UPDATE categories SET basket_marks = {:m} WHERE id = {:id} AND (basket_marks IS NULL OR basket_marks = '')")
      .bind({ m, id: x.id }).execute();
  });
}, (app) => {
  const c = app.findCollectionByNameOrId("categories");
  c.fields.removeByName("basket_marks");
  app.save(c);
});
