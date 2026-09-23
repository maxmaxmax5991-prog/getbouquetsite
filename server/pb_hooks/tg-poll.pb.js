/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает сообщения у Телеграма (long polling).
// Обычный способ (webhook) не работает: Телеграм не может достучаться до сервера — «Connection timed out».
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд, поэтому бот отвечает сразу.

// опрос клиентского бота
cronAdd("tg-poll-client", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);
  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_client_token");
  if (!token) return;   // клиентского бота нет — всё идёт через рабочий
  const key = "tg_offset_client";
  let offset = $app.store().get(key) || 0;
  const until = Date.now() + 52000;
  while (Date.now() < until) {
    let res;
    try {
      res = $http.send({ url: `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}&allowed_updates=["message","callback_query"]`, method: "GET", timeout: 30 });
    } catch (err) { return; }
    if (res.statusCode === 409) { $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 }); continue; }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
    for (const upd of (res.json.result || [])) {
      offset = upd.update_id + 1;
      $app.store().set(key, offset);
      try { bot.handleClient($app, upd); } catch (err) { console.log("client bot", err); }
    }
  }
});

cronAdd("tg-poll", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_token");
  if (!token) return;

  const secret = s.get("tg_secret");
  const key = "tg_offset";
  let offset = $app.store().get(key) || 0;
  const until = Date.now() + 52000;

  while (Date.now() < until) {
    let res;
    try {
      res = $http.send({
        url: `https://api.telegram.org/bot${token}/getUpdates?timeout=20&offset=${offset}&allowed_updates=["message","callback_query"]`,
        method: "GET",
        timeout: 30,
      });
    } catch (err) { return; }                 // нет связи — попробуем через минуту
    if (res.statusCode === 409) {             // остался старый webhook — снимаем и пробуем снова
      $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
      continue;
    }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return;

    const updates = res.json.result || [];
    for (const upd of updates) {
      offset = upd.update_id + 1;
      $app.store().set(key, offset);
      try { bot.handle($app, secret, upd); } catch (err) { console.log("bot error", err); }
    }
  }
});
