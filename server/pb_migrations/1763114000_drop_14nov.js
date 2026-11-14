/// <reference path="../pb_data/types.d.ts" />
// Дроп дня 14.11.2026 — возвращаем его параллельно с партией Фридома.
// Условия как в прошлый раз: 101 роза 40 см за 5 990 ₽ вместо 9 990.
//
// Четыре сорта по просьбе владельца, все ОДНОГОЛОВЫЕ — в дропе только они.
// Количества подобраны так, чтобы у каждого сорта остался запас на каталог:
//   Пич Аваланж   8 × 101 =  808 из 2 399
//   Эльторо       5 × 101 =  505 из   750
//   Перл Аваланж  4 × 101 =  404 из   652
//   Пинк Аваланж  3 × 101 =  303 из   570
// Итого 20 букетов, 2 020 стеблей.
migrate((app) => {
  const день = "2026-11-14";
  try { app.findFirstRecordByFilter("drops", "date = {:d}", { d: день }); return; } catch (_) {}

  const d = new Record(app.findCollectionByNameOrId("drops"));
  d.set("date", день);
  d.set("start_at", `${день} 12:00`);
  d.set("ready_at", `${день} 15:00`);
  d.set("len", 40);
  d.set("cnt", 101);
  d.set("price", 5990);
  // Зачёркнутая цена — решение владельца, а не расчёт по прайсу: 101 роза
  // 40 см в каталоге стоит 6 990, то есть 9 990 выше каталожной. Так же было
  // 09.11, он об этом знает.
  d.set("old_price", 9990);
  d.set("note", "Тот самый букет из Reels");
  d.set("lots", [
    { product: "dv7yttgtdop0bl2", qty: 8, left: 8 },   // Пич Аваланж
    { product: "pccrnsyw8mx1koy", qty: 5, left: 5 },   // Эльторо
    { product: "5pernjak957eifm", qty: 4, left: 4 },   // Перл Аваланж
    { product: "8a6g6vj1v6461rw", qty: 3, left: 3 },   // Пинк Аваланж
  ]);
  d.set("active", true);
  app.save(d);
}, (app) => {
  try { app.delete(app.findFirstRecordByFilter("drops", "date = '2026-11-14'")); } catch (_) {}
});
