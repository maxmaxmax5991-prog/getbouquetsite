/// <reference path="../pb_data/types.d.ts" />
// Два отчёта, которых не хватало: что даёт подпись на карточке и с какого
// места на экране покупают.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня этого файла —
// всё нужное подключается внутри.

// КАК МЫ УЗНАЁМ, ЧТО БЫЛО НАПИСАНО НА КАРТОЧКЕ ВЧЕРА.
// Нигде не хранится: в товаре лежит только сегодняшнее `fresh_date`. Зато
// хранится история привозов — у накладной есть час привоза по плану (`at`) и
// момент, когда нажали «Приехало» (`done_at`). Из них состояние карточки
// восстанавливается точно:
//   до нажатия в день привоза — «приедет к такому-то часу»;
//   после нажатия и до конца суток — «приехало сегодня с теплицы»;
//   всё остальное время — обычная карточка.
// Поэтому отчёт считается только с того дня, как завели накладные.
routerAdd("GET", "/api/shop/stats-labels", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const сегодня = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const from = String(q.get("from") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("from")
    : new Date(Date.now() + 3 * 3600e3 - 13 * 864e5).toISOString().slice(0, 10);
  const to = String(q.get("to") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("to") : сегодня;

  const мск = (s) => {
    const t = String(s || "").replace("T", " ").slice(0, 19);
    if (!t) return null;
    const d = new Date(t.replace(" ", "T") + "Z");
    return isNaN(d) ? null : new Date(d.getTime() + 3 * 3600e3);
  };
  const день = (d) => d.toISOString().slice(0, 10);

  // имена товаров: в событиях лежит название, а в накладной — номер товара
  const имена = {};
  try { $app.findRecordsByFilter("products", "id != ''", "", 500, 0).forEach((p) => { имена[p.id] = p.get("name"); }); } catch (_) {}

  // сорт → отрезки «едет» и «приехало»
  const полосы = {};
  let накладных = 0;
  try {
    $app.findRecordsByFilter("deliveries", "done = true", "at", 300, 0).forEach((d) => {
      const привоз = мск(d.get("done_at"));
      if (!привоз) return;
      накладных++;
      const план = мск(String(d.get("at") || "") + ":00");
      (shop.jget(d, "lines") || []).forEach((l) => {
        const имя = имена[String(l.product || "")];
        if (!имя) return;
        (полосы[имя] = полосы[имя] || []).push({
          день: день(привоз), привоз: привоз.getTime(),
          деньПлана: план ? день(план) : "",
        });
      });
    });
  } catch (err) { console.log("отчёт подписей: накладные", err); }

  const состояние = (имя, когда) => {
    const сп = полосы[имя];
    if (!сп) return "обычная";
    const д = день(когда), t = когда.getTime();
    for (let i = 0; i < сп.length; i++) {
      if (д === сп[i].день && t >= сп[i].привоз) return "приехало";
      if (сп[i].деньПлана && д === сп[i].деньПлана && t < сп[i].привоз) return "едет";
    }
    return "обычная";
  };

  const пусто = () => ({ приехало: { показы: 0, корзины: 0 }, едет: { показы: 0, корзины: 0 }, обычная: { показы: 0, корзины: 0 } });
  const всего = пусто(), посортам = {};
  try {
    const rows = arrayOf(new DynamicModel({ kind: "", ctx: "", at: "" }));
    $app.db().newQuery(
      `SELECT kind, ctx, at FROM events
       WHERE kind IN ('view','cart') AND day >= {:f} AND day <= {:t} LIMIT 80000`)
      .bind({ f: from, t: to }).all(rows);
    rows.forEach((r) => {
      const когда = мск(r.at);
      if (!когда) return;
      // у корзины в метке ещё размер: «Эльторо · 51 шт · 40 см»
      const имя = String(r.ctx || "").split(" · ")[0].trim();
      if (!имя) return;
      const с = состояние(имя, когда);
      const поле = r.kind === "view" ? "показы" : "корзины";
      всего[с][поле]++;
      (посортам[имя] = посортам[имя] || пусто())[с][поле]++;
    });
  } catch (err) { console.log("отчёт подписей", err); }

  const доля = (x) => (x.показы ? +(x.корзины / x.показы * 100).toFixed(1) : null);
  const строки = Object.keys(посортам).map((имя) => {
    const п = посортам[имя];
    return {
      сорт: имя,
      приехало: Object.assign({}, п.приехало, { доля: доля(п.приехало) }),
      едет: Object.assign({}, п.едет, { доля: доля(п.едет) }),
      обычная: Object.assign({}, п.обычная, { доля: доля(п.обычная) }),
      разница: (доля(п.приехало) !== null && доля(п.обычная) !== null)
        ? +(доля(п.приехало) - доля(п.обычная)).toFixed(1) : null,
    };
  }).filter((r) => r.приехало.показы + r.обычная.показы + r.едет.показы >= 30)
    .sort((a, b) => (b.разница === null) - (a.разница === null) || (b.разница - a.разница));

  return e.json(200, {
    from, to, накладных,
    итог: {
      приехало: Object.assign({}, всего.приехало, { доля: доля(всего.приехало) }),
      едет: Object.assign({}, всего.едет, { доля: доля(всего.едет) }),
      обычная: Object.assign({}, всего.обычная, { доля: доля(всего.обычная) }),
    },
    сорта: строки,
  });
}, $apis.requireAuth("managers"));

// С какого места на экране покупают. Сайт отмечает у карточки её место
// («каталог#7»): клик по карточке — `pos`, покупка прямо из списка — `poscart`.
routerAdd("GET", "/api/shop/stats-pos", (e) => {
  const shop = require(`${__hooks}/lib/shop.js`);
  if (!shop.can(e, ["owner", "head"])) return e.json(403, { message: "Недостаточно прав." });
  const q = e.request.url.query();
  const сегодня = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const from = String(q.get("from") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("from")
    : new Date(Date.now() + 3 * 3600e3 - 13 * 864e5).toISOString().slice(0, 10);
  const to = String(q.get("to") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? q.get("to") : сегодня;

  const собрать = (kind) => {
    const карта = {};
    try {
      const rows = arrayOf(new DynamicModel({ ctx: "", n: 0 }));
      $app.db().newQuery(
        `SELECT ctx, COUNT(*) as n FROM events
         WHERE kind = {:k} AND day >= {:f} AND day <= {:t} GROUP BY ctx`)
        .bind({ k: kind, f: from, t: to }).all(rows);
      rows.forEach((r) => { карта[String(r.ctx || "")] = +r.n; });
    } catch (err) { console.log("отчёт мест", kind, err); }
    return карта;
  };
  const клики = собрать("pos"), корзины = собрать("poscart");
  const все = {};
  Object.keys(клики).forEach((k) => все[k] = 1);
  Object.keys(корзины).forEach((k) => все[k] = 1);
  const строки = Object.keys(все).map((k) => {
    const [место, номер] = String(k).split("#");
    return { место: место || "—", номер: +номер || 0, клики: клики[k] || 0, корзины: корзины[k] || 0 };
  }).sort((a, b) => a.место.localeCompare(b.место, "ru") || a.номер - b.номер);

  const поМестам = {};
  строки.forEach((r) => {
    const м = (поМестам[r.место] = поМестам[r.место] || { место: r.место, клики: 0, корзины: 0 });
    м.клики += r.клики; м.корзины += r.корзины;
  });
  return e.json(200, { from, to, ячейки: строки, места: Object.keys(поМестам).map((k) => поМестам[k]) });
}, $apis.requireAuth("managers"));
