/// <reference path="../pb_data/types.d.ts" />
// В каком боте подписан покупатель.
//
// В Телеграме номер собеседника — это номер человека, он одинаков у всех
// ботов, поэтому по customers.tg_chat нельзя понять, кого писать можно, а
// кого нет: бот умеет писать только тем, кто сам его запустил. У витрин свои
// боты (venikoffnetbot, getboquetbot, Lasflore_flow_bot) и свои подписчики, а
// в рассылке был один источник «клиентский бот» — он слал всем подряд ключом
// venikoff, и подписчикам Гет Букета и LasFlore уходило «chat not found».
//
// Теперь у покупателя список витрин через запятую (",venikoff,get,"): его
// пополняет каждое входящее сообщение, а разобрать тех, кто подписался
// раньше, помогает разовый обход getChat (bots-probe.pb.js).
migrate((app) => {
  const c = app.findCollectionByNameOrId("customers");
  if (!c.fields.getByName("tg_brands")) c.fields.add(new Field({ name: "tg_brands", type: "text" }));
  if (!c.fields.getByName("max_brands")) c.fields.add(new Field({ name: "max_brands", type: "text" }));
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  // '' — не идёт, 'start' — начать сначала, '<id>' — место остановки, 'done' — обошли
  if (!s.fields.getByName("bot_probe")) s.fields.add(new Field({ name: "bot_probe", type: "text" }));
  if (!s.fields.getByName("bot_probe_at")) s.fields.add(new Field({ name: "bot_probe_at", type: "text" }));
  app.save(s);
}, (app) => {
  const c = app.findCollectionByNameOrId("customers");
  c.fields.removeByName("tg_brands"); c.fields.removeByName("max_brands");
  app.save(c);
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("bot_probe"); s.fields.removeByName("bot_probe_at");
  app.save(s);
});
