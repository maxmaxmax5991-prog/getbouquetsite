/// <reference path="../pb_data/types.d.ts" />
// Счёт в банк уходит с буквой витрины: «v3171», «g412».
// В кабинете CloudPayments копятся счета за все годы — майские тесты и чужая
// нумерация того же терминала. Наша нумерация уже дважды наступила на занятый
// номер (№3122 и №3112 «оплатились» майскими платежами). Буква делает совпадение
// невозможным и сразу показывает, с какого сайта пришли деньги.
// Номер заказа при этом остаётся прежним — и на сайте, и в МоёмСкладе.
migrate((app) => {
  const b = app.findCollectionByNameOrId("brands");
  if (!b.fields.getByName("pay_prefix")) b.fields.add(new Field({ name: "pay_prefix", type: "text", max: 4 }));
  app.save(b);

  const o = app.findCollectionByNameOrId("orders");
  // Пусто у старых заказов — там счёт по-прежнему голый номер: ссылки на оплату
  // уже выданы покупателям, менять их задним числом нельзя.
  if (!o.fields.getByName("invoice")) o.fields.add(new Field({ name: "invoice", type: "text", max: 24 }));
  app.save(o);

  [["venikoff", "v"], ["get", "g"]].forEach(([slug, p]) => {
    try {
      const r = app.findFirstRecordByFilter("brands", "slug = {:s}", { s: slug });
      if (!r.get("pay_prefix")) { r.set("pay_prefix", p); app.save(r); }
    } catch (_) {}
  });
}, (app) => {
  const b = app.findCollectionByNameOrId("brands");
  b.fields.removeByName("pay_prefix");
  app.save(b);
  const o = app.findCollectionByNameOrId("orders");
  o.fields.removeByName("invoice");
  app.save(o);
});
