/// <reference path="../pb_data/types.d.ts" />
// Бот обзвона открыт для всех, кто в него написал (решение владельца 06.11.2026):
// ссылку на бота дают только своим, а подтверждение владельцем приводило к тому,
// что подключившиеся менеджеры сигналов не получали и об этом никто не знал.
//
//   call_chat_from / call_chat_to — часы по Москве, когда в этот же бот уходят
//   сообщения из чата на сайте (20 → 0 значит «с 20:00 до полуночи»).
// Заодно расширяем call_chats: 300 символов — это около двадцати человек.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  const chats = s.fields.getByName("call_chats");
  if (chats) chats.max = 4000;
  if (!s.fields.getByName("call_chat_from")) s.fields.add(new Field({ name: "call_chat_from", type: "number" }));
  if (!s.fields.getByName("call_chat_to")) s.fields.add(new Field({ name: "call_chat_to", type: "number" }));
  app.save(s);

  // Те, кто уже просился и ждал подтверждения, подключаются прямо сейчас.
  try {
    const rec = app.findFirstRecordByFilter("settings", "id != ''");
    let заявки = [];
    try { заявки = JSON.parse(rec.getString("call_pending") || "[]") || []; } catch (_) {}
    const было = String(rec.get("call_chats") || "").split(/[,\s]+/).filter(Boolean);
    заявки.forEach((z) => { if (z && z.chat && было.indexOf(String(z.chat)) < 0) было.push(String(z.chat)); });
    app.db().newQuery("UPDATE settings SET call_chats = {:c}, call_pending = '[]', call_chat_from = 20, call_chat_to = 0 WHERE id = {:id}")
      .bind({ c: было.join(","), id: rec.id }).execute();
  } catch (_) {}
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("call_chat_from");
  s.fields.removeByName("call_chat_to");
  app.save(s);
});
