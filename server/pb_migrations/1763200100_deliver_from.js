/// <reference path="../pb_data/types.d.ts" />
// «Доставляем не раньше» на карточке товара (`deliver_from`, «ЧЧ:ММ»).
//
// Старое поле `ready_at` — это конкретная дата и час привоза: цветы ещё едут,
// сегодня после 16:40. Оно само истекает к вечеру, и каждый день его надо
// ставить заново. Для букетов, которые собирают во второй половине дня
// ВСЕГДА, этого не хватало: 15.11.2026 на двух букетах со Стичем надпись
// «доставка с 15:00» стояла, а выбрать 12:00 система по-прежнему давала.
//
// Новое поле — не дата, а час суток: ограничение действует в любой день,
// пока его не уберут. Пусто — ограничения нет, как было.
migrate((app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.add(new TextField({ name: "deliver_from", max: 5 }));
  app.save(c);
  // Букеты со Стичем: игрушку вкладывают в готовый букет, и до 15:00 их не отдают.
  app.db().newQuery("UPDATE products SET deliver_from = '15:00' WHERE id IN ('hcbd67scbcpe3pp', 'q3jvmn9j31h5ldo')").execute();
}, (app) => {
  const c = app.findCollectionByNameOrId("products");
  c.fields.removeByName("deliver_from");
  app.save(c);
});
