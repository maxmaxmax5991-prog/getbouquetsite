/// <reference path="../pb_data/types.d.ts" />
// Доставка считается от магазина (Маленковская 14к1), а не по кольцам города:
//   до 5 км — 649 ₽, 5–7,5 км — 699 ₽, 7,5–10 км — 749 ₽,
//   дальше 10 км внутри МКАД — 799 ₽, за МКАД — 850 ₽ + 60 ₽ за километр ОТ МКАД.
// Круги от магазина — это settings.km_mode и справочник delivery_zones; пояса по
// кольцам (mkad_mode) выключаем, но их настройки не стираем: захочется вернуть —
// они на месте.
migrate((app) => {
  const c = app.findCollectionByNameOrId("settings");
  // Цена за МКАД отличается от цены внутри, а раньше mkad_price служил и тем и другим.
  if (!c.fields.getByName("mkad_out_base")) c.fields.add(new Field({ name: "mkad_out_base", type: "number", min: 0 }));
  app.save(c);

  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("km_mode", true);
  s.set("mkad_mode", false);
  s.set("mkad_price", 799);        // дальше кругов, но внутри МКАД
  s.set("mkad_out_base", 850);     // база за МКАД
  s.set("mkad_km_price", 60);      // и за каждый километр от МКАД
  app.save(s);

  const TIERS = [
    { name: "До 5 км от магазина", radius_km: 5, price: 649 },
    { name: "5–7,5 км от магазина", radius_km: 7.5, price: 699 },
    { name: "7,5–10 км от магазина", radius_km: 10, price: 749 },
  ];
  const old = app.findRecordsByFilter("delivery_zones", "id != ''", "sort", 200, 0);
  TIERS.forEach((t, i) => {
    const rec = old[i] || new Record(app.findCollectionByNameOrId("delivery_zones"));
    rec.set("name", t.name);
    rec.set("radius_km", t.radius_km);
    rec.set("price", t.price);
    rec.set("free_from", 0);
    rec.set("active", true);
    rec.set("sort", i);
    app.save(rec);
  });
  // лишние круги убираем: всё, что дальше 10 км, считается уже по МКАД
  old.slice(TIERS.length).forEach((rec) => { rec.set("active", false); app.save(rec); });
}, (app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  s.set("km_mode", false);
  s.set("mkad_mode", true);
  app.save(s);
  const c = app.findCollectionByNameOrId("settings");
  c.fields.removeByName("mkad_out_base");
  app.save(c);
});
