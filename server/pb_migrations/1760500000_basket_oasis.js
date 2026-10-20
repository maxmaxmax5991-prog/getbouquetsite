/// <reference path="../pb_data/types.d.ts" />
// Оазис — свойство корзины, а не сорта.
//
// Сначала я завёл его строкой у каждого количества сорта, но владелец сказал
// проще: сколько оазисов идёт в корзину, зависит только от самой корзины
// (маленькая — 3, средняя — 5 и так далее). Значит и хранить это надо у
// корзины: иначе одно и то же число пришлось бы повторять у каждого из
// двадцати сортов и оно неминуемо разъехалось бы.
//
// У сорта поле остаётся как исключение: пусто — берём из корзины.
migrate((app) => {
  const c = app.findCollectionByNameOrId("baskets");
  const добавить = (f) => { if (!c.fields.getByName(f.name)) c.fields.add(new Field(f)); };
  добавить({ name: "oasis_name", type: "text", max: 200 });
  добавить({ name: "oasis_id", type: "text", max: 60 });
  добавить({ name: "oasis_type", type: "text", max: 20 });
  добавить({ name: "oasis_qty", type: "number", min: 0 });
  app.save(c);

  // Сколько оазисов в какую корзину — со слов владельца 19.10.2026.
  const СКОЛЬКО = {
    "ЛФ-Корзина маленькая": 3, "ЛФ-Корзина средняя": 5, "ЛФ-Корзина большая": 7,
    "ЛФ-Корзина XL": 10, "ЛФ-Корзина XXL": 13, "ЛФ-Корзина XXXL": 16, "ЛФ-Корзина XXXXL": 20,
  };
  let все = [];
  try { все = app.findRecordsByFilter("baskets", "id != ''", "sort", 200, 0); } catch (_) {}
  все.forEach((b) => {
    const n = СКОЛЬКО[String(b.get("name") || "")];
    if (!n) return;
    // Номер номенклатуры проставит кнопка «Найти на складе»: спрашивать склад
    // из миграции нельзя — она задерживает запуск сервера.
    app.db().newQuery(`UPDATE baskets SET oasis_qty = {:q},
        oasis_name = CASE WHEN oasis_name IS NULL OR oasis_name = '' THEN 'ЛФ-Оазис' ELSE oasis_name END
      WHERE id = {:id}`).bind({ q: n, id: b.id }).execute();
  });
}, (app) => {
  const c = app.findCollectionByNameOrId("baskets");
  ["oasis_name", "oasis_id", "oasis_type", "oasis_qty"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
