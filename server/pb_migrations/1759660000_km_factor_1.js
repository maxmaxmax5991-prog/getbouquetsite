/// <reference path="../pb_data/types.d.ts" />
// Поправка к прямой — 1: расстояние считаем как есть, по прямой от магазина.
// При 1,3 почти вся Москва уезжала за десятикилометровый круг и стоила 799 ₽ —
// круги 5 и 7,5 км почти не работали. Владелец решил считать один к одному.
migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("km_factor", 1);
  app.save(s);
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("km_factor", 1.3);
  app.save(s);
});
