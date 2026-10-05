/// <reference path="../pb_data/types.d.ts" />
// Согласия покупателя: на обработку данных и отдельно на рассылку.
//
// Зачем отдельно. Согласие на обработку данных ради доставки заказа НЕ
// разрешает присылать рекламу: для рекламной рассылки нужно предварительное
// согласие адресата (38-ФЗ «О рекламе»). Сейчас рассылка уходит всем, у кого
// есть чат с ботом, и это риск.
//
//   orders.consent_at   — когда и что покупатель подтвердил при оформлении
//   customers.ads_ok    — согласен на новости и предложения
//   customers.ads_at    — когда согласился (нужно, если спросят доказательство)
migrate((app) => {
  const o = app.findCollectionByNameOrId("orders");
  // consent/ads приходят из формы: без объявления в схеме PocketBase их
  // просто не донесёт до обработчика, и проверка согласия всегда падала бы.
  if (!o.fields.getByName("consent")) o.fields.add(new Field({ name: "consent", type: "bool" }));
  if (!o.fields.getByName("ads")) o.fields.add(new Field({ name: "ads", type: "bool" }));
  if (!o.fields.getByName("consent_at")) o.fields.add(new Field({ name: "consent_at", type: "text", max: 40 }));
  app.save(o);

  const c = app.findCollectionByNameOrId("customers");
  if (!c.fields.getByName("ads_ok")) c.fields.add(new Field({ name: "ads_ok", type: "bool" }));
  if (!c.fields.getByName("ads_at")) c.fields.add(new Field({ name: "ads_at", type: "text", max: 40 }));
  app.save(c);

  // Выключатель: пока он выключен, рассылка работает как раньше — по всем, у
  // кого есть чат. Включать осознанно, когда согласия накопятся, иначе
  // рассылка разом обнулится.
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("ads_only_agreed")) s.fields.add(new Field({ name: "ads_only_agreed", type: "bool" }));
  app.save(s);
}, (app) => {
  const o = app.findCollectionByNameOrId("orders");
  ["consent", "ads", "consent_at"].forEach((n) => o.fields.removeByName(n));
  app.save(o);
  const c = app.findCollectionByNameOrId("customers");
  ["ads_ok", "ads_at"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("ads_only_agreed");
  app.save(s);
});
