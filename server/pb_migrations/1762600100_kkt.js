// Онлайн-чек по 54-ФЗ на оплату картой. Настройки кассы держим в settings,
// чтобы система налогообложения и ставка НДС правились без выкладки.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  c.fields.add(new BoolField({ name: "kkt_on" }));
  c.fields.add(new NumberField({ name: "kkt_tax", min: 0, max: 5 }));
  c.fields.add(new TextField({ name: "kkt_vat", max: 4 }));
  app.save(c);
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  if (s) {
    // УСН «доходы минус расходы» (код 2) — сказал владелец 10.11.2026.
    // НДС пустой, то есть «без НДС»: так же стоит у номенклатуры в МоёмСкладе.
    app.db().newQuery("UPDATE settings SET kkt_on = TRUE, kkt_tax = 2, kkt_vat = '' WHERE id = {:id}")
      .bind({ id: s.id }).execute();
  }
}, (app) => {
  const c = app.findCollectionByNameOrId("settings");
  ["kkt_on", "kkt_tax", "kkt_vat"].forEach((n) => c.fields.removeByName(n));
  app.save(c);
});
