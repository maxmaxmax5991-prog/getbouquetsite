// Опрос ботов MAX — по одному заданию на витрину, как и в Телеграме.
// Раньше одно задание делило 50 секунд между витринами: при трёх ботах каждый
// слушал по 16 секунд в минуту, и сообщение покупателя ждало своей очереди.
const shop = require(`${__hooks}/lib/shop.js`);

const БЮДЖЕТ = 50000;

function client(app, слот) {
  const mx = require(`${__hooks}/lib/max.js`);
  let s;
  try { s = shop.settings(app); } catch (_) { return; }

  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true && max_token != ''", "sort", 20, 0); } catch (_) {}
  const legacy = !brands.length && s.get("max_token");
  if (legacy) {
    if (слот !== 0) return;
    pump(app, s, mx, "main", s.get("max_token"), null,
      () => s.get("max_marker") || 0,
      (v) => { try { app.db().newQuery("UPDATE settings SET max_marker = {:v} WHERE id = {:id}").bind({ v, id: s.id }).execute(); } catch (_) {} });
    return;
  }
  const b = brands[слот];
  if (!b) return;
  pump(app, s, mx, b.get("slug"), b.get("max_token"), b,
    () => b.get("max_marker") || 0,
    (v) => { try { app.db().newQuery("UPDATE brands SET max_marker = {:v} WHERE id = {:id}").bind({ v, id: b.id }).execute(); } catch (_) {} });
}

function pump(app, s, mx, name, token, brand, getMarker, saveMarker) {
  const beat = () => { try { app.db().newQuery("UPDATE settings SET max_beat = {:v} WHERE id = {:id}").bind({ v: Date.now(), id: s.id }).execute(); } catch (_) {} };
  let marker = getMarker();
  const until = Date.now() + БЮДЖЕТ;
  while (Date.now() < until) {
    const r = mx.updates(token, marker);
    if (!r.ok) return;                    // нет связи или ключ не подошёл — до следующей минуты
    beat();
    const list = (r.data && r.data.updates) || [];
    for (const u of list) {
      try { mx.handle(app, u, brand); }
      catch (err) { console.log("max bot", name, err); require(`${__hooks}/lib/err.js`).note(app, "MAX " + name, String(err), ""); }
    }
    const next = r.data && r.data.marker;
    if (next && next !== marker) { marker = next; saveMarker(marker); }
  }
}

module.exports = { client };
