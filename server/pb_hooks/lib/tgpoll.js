// Опрос клиентских ботов Телеграма — по одному заданию на витрину.
//
// Раньше все витрины опрашивало одно задание, и 45 секунд делились между ними:
// при трёх ботах каждый слушал по 15 секунд в минуту, а остальные 45 сообщения
// просто лежали в Телеграме. Покупатель писал — менеджер узнавал об этом почти
// через минуту. Теперь у каждой витрины своё задание, и её бот держит
// соединение почти всю минуту.
//
// Задания в pb_hooks зовут client($app, 0), client($app, 1) и так далее —
// внутрь обработчика не видно ни переменных, ни цикла, поэтому слот передают
// числом.
const shop = require(`${__hooks}/lib/shop.js`);

const БЮДЖЕТ = 50000;        // короче минуты: следующий тик не должен налезть
const ЖИВ = 70000;           // замок считаем свежим столько времени

function client(app, слот) {
  const bot = require(`${__hooks}/lib/bot.js`);
  let s;
  try { s = shop.settings(app); } catch (_) { return; }

  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true && tg_client_token != ''", "sort", 20, 0); } catch (_) {}
  // ни у одной витрины ключа нет — работаем по-старому, от общих настроек
  const legacy = !brands.length && s.get("tg_client_token");
  if (legacy) {
    if (слот !== 0) return;
    pump(app, s, bot, "main", s.get("tg_client_token"), null,
      () => s.get("tg_offset_client") || 0,
      (v) => { try { app.db().newQuery("UPDATE settings SET tg_offset_client = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); } catch (_) {} });
    return;
  }
  const b = brands[слот];
  if (!b) return;            // витрин меньше, чем заданий — лишние просто молчат
  pump(app, s, bot, b.get("slug"), b.get("tg_client_token"), b,
    () => b.get("tg_offset") || 0,
    (v) => { try { app.db().newQuery("UPDATE brands SET tg_offset = {:v} WHERE id = {:id}").bind({ v, id: b.id }).execute(); } catch (_) {} });
}

function pump(app, s, bot, name, token, brand, getOffset, saveOffset) {
  const key = "poll:tg_client:" + name;
  const held = () => {
    try {
      const row = new DynamicModel({ value: "" });
      app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: key }).one(row);
      return String(row.value || "") > new Date(Date.now() - ЖИВ).toISOString();
    } catch (_) { return false; }
  };
  const touch = () => {
    try {
      app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:v})
        ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:v}`)
        .bind({ k: key, v: new Date().toISOString() }).execute();
    } catch (_) {}
  };
  const beat = () => { try { app.db().newQuery("UPDATE settings SET tg_beat_client = {:v} WHERE id = {:id}").bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };
  // Замок снимаем, когда цикл честно закончился: каждый удачный опрос его
  // обновляет, и через минуту он был бы ещё «свежим» — задание пропускало бы
  // минуту целиком. От подвисшего запроса это не ослабляет: туда исполнение
  // просто не доходит.
  const release = () => {
    try {
      app.db().newQuery("UPDATE watchdog_state SET value = {:v} WHERE key = {:k}")
        .bind({ k: key, v: new Date(0).toISOString() }).execute();
    } catch (_) {}
  };

  if (held()) return;
  touch();
  let offset = getOffset();
  const until = Date.now() + БЮДЖЕТ;
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
      beat(); touch();
      const updates = res.json.result || [];
      for (const upd of updates) {
        offset = upd.update_id + 1;
        // Позицию сохраняем ДО обработки: если сервер перезапустится посреди
        // пачки, то же нажатие пришло бы второй раз.
        saveOffset(offset);
        try { bot.handleClient(app, upd, brand); }
        catch (err) { console.log("client bot", name, err); require(`${__hooks}/lib/err.js`).note(app, "Клиентский бот " + name, String(err), ""); }
      }
    }
  } finally { release(); }
}

module.exports = { client };
