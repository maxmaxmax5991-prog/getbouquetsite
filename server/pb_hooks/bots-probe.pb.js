/// <reference path="../pb_data/types.d.ts" />
// Разбор: кто в каком клиентском боте Телеграма.
//
// Номер собеседника в Телеграме один и тот же у всех ботов, поэтому по базе
// нельзя понять, кого витрина вправе писать: бот отвечает только тем, кто сам
// его запустил. Зато это знает сам Телеграм: getChat на «своего» отдаёт чат,
// на чужого — «chat not found». Обходим покупателей порциями раз в минуту и
// проставляем метки, дальше их поддерживает каждое входящее сообщение.
//
// Обход разовый и по кнопке: это тысячи запросов к Телеграму, гонять их
// постоянно незачем.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное
// пишем внутри обработчика.
routerAdd("POST", "/api/bc/probe", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const s = shop.settings($app);
  const идёт = String(s.get("bot_probe") || "");
  const надо = e.requestInfo().body && e.requestInfo().body.stop;
  $app.db().newQuery("UPDATE settings SET bot_probe = {:v}, bot_probe_at = {:t} WHERE id = {:id}")
    .bind({ v: надо ? "" : "start", t: new Date().toISOString(), id: s.id }).execute();
  return e.json(200, { ok: true, был: идёт, статус: надо ? "" : "start" });
}, $apis.requireAuth("managers"));

cronAdd("bots-probe", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const место = String(s.get("bot_probe") || "");
  if (!место || место === "done") return;

  let brands = [];
  try { brands = $app.findRecordsByFilter("brands", "active = true && tg_client_token != ''", "sort", 20, 0); } catch (_) {}
  if (!brands.length) {
    try { $app.db().newQuery("UPDATE settings SET bot_probe = 'done' WHERE id = {:id}").bind({ id: s.id }).execute(); } catch (_) {}
    return;
  }

  const курсор = место === "start" ? "" : место;
  let люди = [];
  try {
    люди = $app.findRecordsByFilter("customers", "tg_chat != '' && id > {:l}", "id", 200, 0, { l: курсор });
  } catch (_) { return; }

  if (!люди.length) {
    try {
      $app.db().newQuery("UPDATE settings SET bot_probe = 'done', bot_probe_at = {:t} WHERE id = {:id}")
        .bind({ t: new Date().toISOString(), id: s.id }).execute();
    } catch (_) {}
    return;
  }

  const until = Date.now() + 45000;
  let последний = курсор;
  for (const c of люди) {
    if (Date.now() > until) break;
    const чат = String(c.get("tg_chat") || "");
    // Запятая в начале и конце — чтобы «get» не находился внутри другого слуга.
    let метки = ",";
    for (const b of brands) {
      let res = null;
      try {
        res = $http.send({
          url: `https://api.telegram.org/bot${b.get("tg_client_token")}/getChat?chat_id=${encodeURIComponent(чат)}`,
          method: "GET", timeout: 20,
        });
      } catch (_) { continue; }
      if (res.statusCode === 429) { return; }          // упёрлись в предел — продолжим через минуту
      if (res.statusCode === 200 && res.json && res.json.ok) метки += b.get("slug") + ",";
    }
    try {
      $app.db().newQuery("UPDATE customers SET tg_brands = {:v} WHERE id = {:id}")
        .bind({ v: метки, id: c.id }).execute();
    } catch (err) { console.log("bots-probe", err); }
    последний = c.id;
  }

  try {
    $app.db().newQuery("UPDATE settings SET bot_probe = {:v}, bot_probe_at = {:t} WHERE id = {:id}")
      .bind({ v: последний, t: new Date().toISOString(), id: s.id }).execute();
  } catch (_) {}
});
