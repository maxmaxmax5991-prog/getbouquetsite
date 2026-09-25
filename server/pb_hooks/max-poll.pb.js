/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает события у MAX (long polling), как и у Телеграма:
// webhook не подходит, снаружи до сервера не достучаться.
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное пишем внутри задания.
cronAdd("max-poll", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const mx = require(`${__hooks}/lib/max.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  if (!s.get("max_token")) return;   // MAX не подключён

  // позицию пишем прямым запросом в базу, мимо хуков на настройках:
  // обычное сохранение будит обработчик, который переподключает ботов
  const saveMarker = (v) => {
    try { $app.db().newQuery("UPDATE settings SET max_marker = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); }
    catch (err) { console.log("max marker", err); }
  };

  const token = s.get("max_token");
  let marker = s.get("max_marker") || 0;
  const until = Date.now() + 52000;

  while (Date.now() < until) {
    const r = mx.updates(token, marker);
    if (!r.ok) return;
    try { $app.db().newQuery("UPDATE settings SET max_beat = {:v} WHERE id = {:id}").bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {}                      // нет связи или ключ не подошёл — попробуем через минуту
    const list = (r.data && r.data.updates) || [];
    for (const u of list) {
      try { mx.handle($app, u); } catch (err) { console.log("max bot", err); }
    }
    const next = r.data && r.data.marker;
    if (next && next !== marker) { marker = next; saveMarker(marker); }
    else if (!list.length) continue;        // событий не было — ждём дальше
  }
});
