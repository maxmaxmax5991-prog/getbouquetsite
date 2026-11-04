/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает сообщения у Телеграма (long polling).
// Обычный способ (webhook) не работает: Телеграм не может достучаться до сервера — «Connection timed out».
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд, поэтому бот отвечает сразу.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня, поэтому всё нужное пишем внутри задания.

// Опрос клиентских ботов: по заданию на витрину. Сами задания ничего не умеют,
// вся работа в lib/tgpoll.js — обработчик не видит код верхнего уровня этого
// файла, поэтому номер витрины передаём числом, а не перебираем циклом.
// Четыре слота с запасом: лишние молча выходят, пятую витрину нужно будет
// дописать строкой здесь.
cronAdd("tg-poll-client", "* * * * *", () => { require(`${__hooks}/lib/tgpoll.js`).client($app, 0); });
cronAdd("tg-poll-client-2", "* * * * *", () => { require(`${__hooks}/lib/tgpoll.js`).client($app, 1); });
cronAdd("tg-poll-client-3", "* * * * *", () => { require(`${__hooks}/lib/tgpoll.js`).client($app, 2); });
cronAdd("tg-poll-client-4", "* * * * *", () => { require(`${__hooks}/lib/tgpoll.js`).client($app, 3); });

// опрос служебного бота (@venikoffbot): остатки, фото флористов, доступы
cronAdd("tg-poll", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_token");
  if (!token) return;

  // Замок на опрос: цикл держится 52 секунды, а задание запускается раз в минуту.
  // Если запрос к Телеграму подвис, следующий тик поднимал второй опрос поверх первого,
  // и одно и то же сообщение обрабатывалось дважды-трижды. Живой замок пропускаем.
  const lockKey = "poll:tg_main";
  const held = (() => {
    try {
      const row = new DynamicModel({ value: "" });
      $app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: lockKey }).one(row);
      return String(row.value || "") > new Date(Date.now() - 70000).toISOString();
    } catch (_) { return false; }
  })();
  if (held) return;
  const touch = () => {
    try {
      $app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:v})
        ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:v}`)
        .bind({ k: lockKey, v: new Date().toISOString() }).execute();
    } catch (_) {}
  };
  touch();

  const saveOffset = (v) => {
    try { $app.db().newQuery("UPDATE settings SET tg_offset = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); }
    catch (err) { console.log("offset", err); }
  };

  const beat = (f) => { try { $app.db().newQuery(`UPDATE settings SET ${f} = {:v} WHERE id = {:id}`).bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };

  // Замок снимаем, когда цикл честно закончился. Иначе он оставался свежим
  // (его трогает каждый удачный опрос), следующий тик видел «ещё занято» и
  // пропускал минуту: бот читал входящие только половину времени, а при заминке
  // у Телеграма отметка старела сразу на несколько минут. Подвисший запрос сюда
  // не доходит — от него замок и защищает.
  const release = () => {
    try {
      $app.db().newQuery("UPDATE watchdog_state SET value = {:v} WHERE key = {:k}")
        .bind({ k: lockKey, v: new Date(0).toISOString() }).execute();
    } catch (_) {}
  };

  const secret = s.get("tg_secret");
  let offset = s.get("tg_offset") || 0;
  const until = Date.now() + 45000;   // короче минуты: следующий тик не должен налезть
  let conflicts = 0;

  try {
  while (Date.now() < until) {
    // Сколько ещё можно ждать ответа. Раньше тут стояло глухое timeout=20:
    // последний запрос начинался за пять секунд до конца цикла и висел до
    // следующей минуты. Тик в это время видел незанятый ещё замок и пропускал
    // минуту целиком — замер 04.10 в 19:46 показал ровно это. Клиентский опрос
    // так считал с самого начала, главный — нет.
    const wait = Math.max(1, Math.min(20, Math.round((until - Date.now()) / 1000) - 5));
    let res;
    try {
      res = $http.send({
        url: `https://api.telegram.org/bot${token}/getUpdates?timeout=${wait}&offset=${offset}&allowed_updates=["message","callback_query"]`,
        method: "GET",
        timeout: wait + 10,
      });
    } catch (err) { return; }                 // нет связи — попробуем через минуту
    if (res.statusCode === 409) {             // остался старый webhook или опрос не завершился
      if (++conflicts > 2) return;
      $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
      continue;
    }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
    beat("tg_beat"); touch();

    const updates = res.json.result || [];
    for (const upd of updates) {
      offset = upd.update_id + 1;
      saveOffset(offset);   // до обработки: перезапуск не должен повторять сообщение
      try { bot.handle($app, secret, upd); } catch (err) { console.log("bot error", err); require(`${__hooks}/lib/err.js`).note($app, "Служебный бот", String(err), ""); }
    }
  }
  } finally { release(); }
});
