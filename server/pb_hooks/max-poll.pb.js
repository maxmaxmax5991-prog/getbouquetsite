/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает события у MAX (long polling), как и у Телеграма:
// webhook не подходит, снаружи до сервера не достучаться.
// Задание запускается раз в минуту и внутри держит соединение ~50 секунд.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё нужное пишем внутри задания.
// События MAX по витринам: у каждой свой бот и своя позиция чтения.
// Время задания делим между ботами, чтобы уложиться в минуту.
cronAdd("max-poll", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const mx = require(`${__hooks}/lib/max.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }

  let brands = [];
  try { brands = $app.findRecordsByFilter("brands", "active = true && max_token != ''", "sort", 20, 0); } catch (_) {}
  const legacy = !brands.length && s.get("max_token");
  if (!brands.length && !legacy) return;   // MAX не подключён ни у кого

  const beat = () => { try { $app.db().newQuery("UPDATE settings SET max_beat = {:v} WHERE id = {:id}").bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };

  const pump = (name, token, brand, getMarker, saveMarker, budget) => {
    let marker = getMarker();
    const until = Date.now() + budget;
    while (Date.now() < until) {
      const r = mx.updates(token, marker);
      if (!r.ok) return;                    // нет связи или ключ не подошёл — до следующей минуты
      beat();
      const list = (r.data && r.data.updates) || [];
      for (const u of list) {
        try { mx.handle($app, u, brand); }
        catch (err) { console.log("max bot", name, err); require(`${__hooks}/lib/err.js`).note($app, "MAX " + name, String(err), ""); }
      }
      const next = r.data && r.data.marker;
      if (next && next !== marker) { marker = next; saveMarker(marker); }
    }
  };

  if (legacy) {
    pump("main", s.get("max_token"), null,
      () => s.get("max_marker") || 0,
      (v) => { try { $app.db().newQuery("UPDATE settings SET max_marker = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); } catch (_) {} },
      50000);
    return;
  }

  const budget = Math.floor(50000 / brands.length);
  brands.forEach((b) => {
    pump(b.get("slug"), b.get("max_token"), b,
      () => b.get("max_marker") || 0,
      (v) => { try { $app.db().newQuery("UPDATE brands SET max_marker = {:v} WHERE id = {:id}").bind({ v, id: b.id }).execute(); } catch (_) {} },
      budget);
  });
});
