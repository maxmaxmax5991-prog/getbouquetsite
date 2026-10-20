/// <reference path="../pb_data/types.d.ts" />
// Выключатель почасовой тасовки карточек.
//
// Зачем вообще тасовать. Место на экране решает не меньше, чем сорт: первые
// карточки собирают кратно больше кликов просто потому, что они первые. При
// постоянном порядке одни и те же сорта всегда наверху, остальные не видит
// почти никто — и статистика мест сама себя подтверждает. Раз в час порядок
// меняется, и за сутки каждый сорт успевает побывать в хороших местах.
//
// Выключатель нужен, потому что это заметная для покупателя вещь: если
// владельцу не понравится, он должен гасить её сам, не дожидаясь правки кода.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("shuffle_hourly")) s.fields.add(new Field({ name: "shuffle_hourly", type: "bool" }));
  app.save(s);
  // Включаем сразу: ради этого и заводили.
  app.db().newQuery("UPDATE settings SET shuffle_hourly = true").execute();
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("shuffle_hourly");
  app.save(s);
});
