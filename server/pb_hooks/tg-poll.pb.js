/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает сообщения у Телеграма (long polling).
// Обычный способ (webhook) не работает: Телеграм не может достучаться до сервера — «Connection timed out».
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд, поэтому бот отвечает сразу.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня, поэтому всё нужное пишем внутри задания.

// опрос клиентского бота (@venikoffnetbot) — статусы заказа, вход в кабинет, оценка фото
// Клиентские боты всех витрин. У каждой витрины свой бот и своя позиция чтения:
// один ключ — один опрос, иначе Телеграм отвечает 409 и сообщения теряются.
// Время делим между ботами, чтобы задание укладывалось в минуту.
cronAdd("tg-poll-client", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const bot = require(`${__hooks}/lib/bot.js`);
  let s;
  try { s = shop.settings($app); } catch (_) { return; }

  let brands = [];
  try { brands = $app.findRecordsByFilter("brands", "active = true && tg_client_token != ''", "sort", 20, 0); } catch (_) {}
  // ни у одной витрины ключа нет — работаем по-старому, от общих настроек
  const legacy = !brands.length && s.get("tg_client_token");
  if (!brands.length && !legacy) return;

  const held = (key) => {
    try {
      const row = new DynamicModel({ value: "" });
      $app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: key }).one(row);
      return String(row.value || "") > new Date(Date.now() - 70000).toISOString();
    } catch (_) { return false; }
  };
  const touch = (key) => {
    try {
      $app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:v})
        ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:v}`)
        .bind({ k: key, v: new Date().toISOString() }).execute();
    } catch (_) {}
  };
  const beat = () => { try { $app.db().newQuery("UPDATE settings SET tg_beat_client = {:v} WHERE id = {:id}").bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };
  // Цикл закончился — замок снимаем, иначе следующая минута пропускается целиком:
  // каждый удачный опрос обновляет замок, и через минуту он ещё «свежий».
  // От подвисшего запроса это не ослабляет: туда исполнение просто не доходит.
  const release = (key) => {
    try {
      $app.db().newQuery("UPDATE watchdog_state SET value = {:v} WHERE key = {:k}")
        .bind({ k: key, v: new Date(0).toISOString() }).execute();
    } catch (_) {}
  };

  // один бот: опрашиваем, пока не кончится его доля времени
  const pump = (name, token, brand, getOffset, saveOffset, budget) => {
    const key = "poll:tg_client:" + name;
    if (held(key)) return;
    touch(key);
    let offset = getOffset();
    const until = Date.now() + budget;
    let conflicts = 0;
    try {
    while (Date.now() < until) {
      const wait = Math.max(1, Math.min(20, Math.round((until - Date.now()) / 1000) - 5));
      let res;
      try {
        res = $http.send({ url: `https://api.telegram.org/bot${token}/getUpdates?timeout=${wait}&offset=${offset}&allowed_updates=["message","callback_query"]`, method: "GET", timeout: wait + 10 });
      } catch (err) { return; }
      if (res.statusCode === 409) {            // остался webhook или чужой опрос
        if (++conflicts > 2) return;
        $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
        continue;
      }
      if (res.statusCode !== 200 || !res.json || !res.json.ok) return;
      beat(); touch(key);
      const updates = res.json.result || [];
      for (const upd of updates) {
        offset = upd.update_id + 1;
        // Позицию сохраняем ДО обработки: если сервер перезапустится посреди пачки,
        // то же нажатие пришло бы второй раз.
        saveOffset(offset);
        try { bot.handleClient($app, upd, brand); }
        catch (err) { console.log("client bot", name, err); require(`${__hooks}/lib/err.js`).note($app, "Клиентский бот " + name, String(err), ""); }
      }
    }
    } finally { release(key); }
  };

  if (legacy) {
    pump("main", s.get("tg_client_token"), null,
      () => s.get("tg_offset_client") || 0,
      (v) => { try { $app.db().newQuery("UPDATE settings SET tg_offset_client = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); } catch (_) {} },
      45000);
    return;
  }

  const budget = Math.floor(45000 / brands.length);
  brands.forEach((b) => {
    pump(b.get("slug"), b.get("tg_client_token"), b,
      () => b.get("tg_offset") || 0,
      (v) => { try { $app.db().newQuery("UPDATE brands SET tg_offset = {:v} WHERE id = {:id}").bind({ v, id: b.id }).execute(); } catch (_) {} },
      budget);
  });
});

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
