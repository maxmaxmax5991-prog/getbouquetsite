/// <reference path="../pb_data/types.d.ts" />
// Реальные заказы после перехода из уведомления; уникальные посетители по vid.
routerAdd("GET", "/api/shop/mother-notice-stats", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, {message:"Недостаточно прав."});
  let brand = "";
  try { const b = require(`${__hooks}/lib/brand.js`).byHost($app,e); brand = b ? b.id : ""; } catch (_) {}
  const row = new DynamicModel({shown:0,clicked:0,closed:0,orders:0,converted:0,paid_orders:0,paid_visitors:0});
  $app.db().newQuery(`WITH campaign AS (
    SELECT vid, kind, at FROM events WHERE brand = {:brand} AND ctx = 'mother2026'
      AND day >= '2026-11-23' AND day <= '2026-11-29'
      AND kind IN ('mother_show','mother_click','mother_close')
  ), attributed AS (
    SELECT o.id, o.vid, o.payment_status FROM orders o
    WHERE o.brand = {:brand} AND o.date = '2026-11-29' AND o.status != 'cancelled'
      AND EXISTS (SELECT 1 FROM campaign c WHERE c.kind = 'mother_click' AND c.vid = o.vid
        AND julianday(o.created) >= julianday(c.at)
        AND julianday(o.created) <= julianday(c.at) + 7)
  )
  SELECT (SELECT COUNT(DISTINCT vid) FROM campaign WHERE kind='mother_show') AS shown,
    (SELECT COUNT(DISTINCT vid) FROM campaign WHERE kind='mother_click') AS clicked,
    (SELECT COUNT(DISTINCT vid) FROM campaign WHERE kind='mother_close') AS closed,
    (SELECT COUNT(*) FROM attributed) AS orders,
    (SELECT COUNT(DISTINCT vid) FROM attributed) AS converted,
    (SELECT COUNT(*) FROM attributed WHERE payment_status='paid') AS paid_orders,
    (SELECT COUNT(DISTINCT vid) FROM attributed WHERE payment_status='paid') AS paid_visitors`)
    .bind({brand}).one(row);
  const percent = (n,d) => d ? Math.round(n/d*10000)/100 : 0;
  return e.json(200,{shown:+row.shown,clicked:+row.clicked,closed:+row.closed,orders:+row.orders,
    converted:+row.converted,paid_orders:+row.paid_orders,paid_visitors:+row.paid_visitors,
    ctr:percent(row.clicked,row.shown),order_conversion:percent(row.converted,row.clicked),
    paid_conversion:percent(row.paid_visitors,row.clicked)});
}, $apis.requireAuth("managers"));
