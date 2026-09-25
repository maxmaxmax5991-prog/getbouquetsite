/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает сообщения у Телеграма (long polling).
// Обычный способ (webhook) не работает: Телеграм не может достучаться до сервера — «Connection timed out».
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд, поэтому бот отвечает сразу.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня, поэтому всё нужное пишем внутри задания.

// опрос клиентского бота (@venikoffnetbot) — статусы заказа, вход в кабинет, оценка фото
cronAdd("tg-poll-client", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);
  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_client_token");
  if (!token) return;   // клиентского бота нет — всё идёт через рабочий

  // позицию пишем запросом в базу, а не обычным сохранением: иначе срабатывает хук на настройках
  // и бот каждый раз заново подключается к Телеграму
  const saveOffset = (v) => {
    try { $app.db().newQuery("UPDATE settings SET tg_offset_client = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); }
    catch (err) { console.log("offset client", err); }
  };

  // «бот жив» — по этой отметке сторож понимает, что опрос идёт
  const beat = (f) => { try { $app.db().newQuery(`UPDATE settings SET ${f} = {:v} WHERE id = {:id}`).bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };

  let offset = s.get("tg_offset_client") || 0;
  const until = Date.now() + 52000;
  let conflicts = 0;
  while (Date.now() < until) {
    let res;
    try {
      res = $http.send({ url: `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}&allowed_updates=["message","callback_query"]`, method: "GET", timeout: 30 });
    } catch (err) { return; }
    if (res.statusCode === 409) {                 // другой опрос ещё идёт или остался webhook
      if (++conflicts > 2) return;                // не долбим Телеграм — подождём до следующей минуты
      $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
      continue;
    }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
    beat("tg_beat_client");
    const updates = res.json.result || [];
    for (const upd of updates) {
      offset = upd.update_id + 1;
      try { bot.handleClient($app, upd); } catch (err) { console.log("client bot", err); }
    }
    if (updates.length) saveOffset(offset);
  }
});

// опрос служебного бота (@newbouquet_bot) — товары, заказы, фото букета
cronAdd("tg-poll", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_token");
  if (!token) return;

  const saveOffset = (v) => {
    try { $app.db().newQuery("UPDATE settings SET tg_offset = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); }
    catch (err) { console.log("offset", err); }
  };

  const beat = (f) => { try { $app.db().newQuery(`UPDATE settings SET ${f} = {:v} WHERE id = {:id}`).bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };

  const secret = s.get("tg_secret");
  let offset = s.get("tg_offset") || 0;
  const until = Date.now() + 52000;
  let conflicts = 0;

  while (Date.now() < until) {
    let res;
    try {
      res = $http.send({
        url: `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}&allowed_updates=["message","callback_query"]`,
        method: "GET",
        timeout: 30,
      });
    } catch (err) { return; }                 // нет связи — попробуем через минуту
    if (res.statusCode === 409) {             // остался старый webhook или опрос не завершился
      if (++conflicts > 2) return;
      $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
      continue;
    }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
    beat("tg_beat");

    const updates = res.json.result || [];
    for (const upd of updates) {
      offset = upd.update_id + 1;
      try { bot.handle($app, secret, upd); } catch (err) { console.log("bot error", err); }
    }
    if (updates.length) saveOffset(offset);
  }
});
