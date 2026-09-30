/// <reference path="../pb_data/types.d.ts" />
// Пересчёт области под две опорные точки владельца: Химки ≈ 1200 ₽, Одинцово не
// ниже 1450 ₽. База 1000 ₽ (в неё входит 12 км от магазина), дальше 35 ₽/км.
// Выходит: Мытищи 1035, Химки и Королёв 1210, Балашиха 1245, Красногорск 1420,
// Видное и Одинцово 1525.
migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("mkad_out_base", 1000);
  s.set("mkad_km_from", 12);
  s.set("mkad_km_price", 35);
  app.save(s);
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("mkad_out_base", 850);
  s.set("mkad_km_from", 15);
  s.set("mkad_km_price", 55);
  app.save(s);
});
