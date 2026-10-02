// Поставки накладными. Накладная — один документ: поставщик, время привоза и
// строки «сорт, длина, сколько». Пришла машина — одна кнопка на всю накладную.
//
// products.incoming пересчитывается из ОТКРЫТЫХ накладных целиком, а не правится
// по кусочку: так он не разъедется с накладными, что бы с ними ни делали.
const shop = require(`${__hooks}/lib/shop.js`);

function пересчитать(app) {
  const надо = {};                       // id товара → { длина: {qty, at} }
  let открытые = [];
  try { открытые = app.findRecordsByFilter("deliveries", "done = false", "at", 200, 0); } catch (_) {}
  открытые.forEach((d) => {
    const at = String(d.get("at") || "").trim();
    (shop.jget(d, "lines") || []).forEach((l) => {
      const id = String(l.product || ""), len = String(l.len || ""), qty = Math.max(0, Math.round(+l.qty || 0));
      if (!id || !/^\d+$/.test(len) || !qty) return;
      надо[id] = надо[id] || {};
      // две накладные на один сорт: количества складываем, ждать — до поздней
      const было = надо[id][len];
      надо[id][len] = было
        ? { qty: было.qty + qty, at: (было.at && at && было.at > at) ? было.at : (at || было.at) }
        : { qty, at };
    });
  });

  // Пишем всем, у кого привоз есть или был: иначе закрытая накладная оставила бы хвост
  let все = [];
  try { все = app.findRecordsByFilter("products", "id != ''", "", 500, 0); } catch (_) { return; }
  все.forEach((p) => {
    const стало = надо[p.id] || {};
    const было = shop.incomingOf(p);
    if (JSON.stringify(было) === JSON.stringify(стало)) return;
    try {
      app.db().newQuery("UPDATE products SET incoming = {:v} WHERE id = {:id}")
        .bind({ v: JSON.stringify(стало), id: p.id }).execute();
    } catch (err) { console.log("привоз", p.id, err); }
  });
}

// Перенести накладную в остатки
function привезли(app, d) {
  const сорта = {};
  (shop.jget(d, "lines") || []).forEach((l) => {
    const id = String(l.product || ""), len = String(l.len || ""), qty = Math.max(0, Math.round(+l.qty || 0));
    if (!id || !/^\d+$/.test(len) || !qty) return;
    сорта[id] = сорта[id] || {};
    сорта[id][len] = (сорта[id][len] || 0) + qty;
  });

  let товаров = 0, стеблей = 0;
  Object.keys(сорта).forEach((id) => {
    let p = null;
    try { p = app.findRecordById("products", id); } catch (_) { return; }
    const st = shop.stockOf(p);
    Object.keys(сорта[id]).forEach((len) => { st[len] = Math.max(0, (+st[len] || 0) + сорта[id][len]); стеблей += сорта[id][len]; });
    try {
      // fresh_date — «сегодня с теплицы»: привезли именно сегодня
      app.db().newQuery("UPDATE products SET stock = {:v}, fresh_date = {:f}, ready_at = '' WHERE id = {:id}")
        .bind({ v: JSON.stringify(st), f: shop.moscowToday(), id: p.id }).execute();
      товаров++;
    } catch (err) { console.log("привоз в остаток", id, err); }
  });

  d.set("done", true);
  d.set("done_at", new Date().toISOString());
  app.save(d);
  пересчитать(app);
  return { товаров, стеблей };
}

module.exports = { пересчитать, привезли };
