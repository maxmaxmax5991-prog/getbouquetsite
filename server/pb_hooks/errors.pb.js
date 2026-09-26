/// <reference path="../pb_data/types.d.ts" />
// Табло ошибок: приём с сайта и выдача в админку.

// Сайт присылает свои поломки (ошибка в скрипте у покупателя — мы бы о ней не узнали)
routerAdd("POST", "/api/shop/js-error", (e) => {
  const err = require(`${__hooks}/lib/err.js`);
  const b = e.requestInfo().body || {};
  const text = String(b.text || "").slice(0, 400);
  if (!text) return e.json(200, { ok: true });
  err.note($app, "сайт", text, String(b.where || "").slice(0, 200));
  return e.json(200, { ok: true });
});

// Админка: список
routerAdd("GET", "/api/shop/errors", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const withFixed = e.request.url.query().get("all") === "1";
  const out = [];
  try {
    const list = arrayOf(new DynamicModel({ key: "", place: "", text: "", ctx: "", count: 0, first_at: "", last_at: "", fixed: 0 }));
    $app.db().newQuery(`SELECT key, place, text, ctx, count, first_at, last_at, fixed FROM errors
      ${withFixed ? "" : "WHERE fixed = 0"} ORDER BY last_at DESC LIMIT 200`).all(list);
    list.forEach((r) => out.push({
      key: r.key, place: r.place, text: r.text, ctx: r.ctx,
      count: +r.count, first_at: r.first_at, last_at: r.last_at, fixed: !!+r.fixed,
    }));
  } catch (err) { console.log("табло", err); }
  return e.json(200, { errors: out });
}, $apis.requireAuth("managers"));

// Админка: отметить починенным или убрать
routerAdd("POST", "/api/shop/errors", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (shop.role(e) !== "owner") return e.json(403, { message: "Это может только владелец." });
  const b = e.requestInfo().body || {};
  const key = String(b.key || "");
  try {
    if (b.clear) $app.db().newQuery("DELETE FROM errors WHERE fixed = 1").execute();
    else if (key) $app.db().newQuery("UPDATE errors SET fixed = 1 WHERE key = {:k}").bind({ k: key }).execute();
  } catch (err) { return e.json(400, { message: String(err) }); }
  return e.json(200, { ok: true });
}, $apis.requireAuth("managers"));
