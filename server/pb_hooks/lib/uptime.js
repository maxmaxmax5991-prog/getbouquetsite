// Контроль доступности. Раз в минуту дёргаем сайт теми же путями, какими до
// него идёт покупатель, и записываем, ответил ли он и за сколько.
//
// Зачем: 5 ноября выяснилось, что с части зарубежных сетей и VPN маршрут до
// московского хостинга рвётся — DNS отвечает, а соединение не доходит. Узнали
// мы об этом только потому, что владельцу пожаловались. Кто не загрузил сайт,
// тот и в счётчик посещений не попал, так что «как часто» ответить было нечем.
//
// Что проверяем:
//   сайт          — страница целиком через наш домен (Caddy → PocketBase → база)
//   запасной вход — тот же сайт через сервер в Нидерландах
//   склад         — отвечает ли МойСклад (без него заказы копятся в очереди)
//   банк          — отвечает ли CloudPayments (без него не принять оплату)
//
// Чего эта проверка НЕ видит: сломанный маршрут у конкретного покупателя.
// Наши серверы ходят своими путями, чужую сеть с них не пощупать — для этого
// нужен внешний сервис с проверками из разных стран.
const shop = require(`${__hooks}/lib/shop.js`);

const ПОДРЯД = 3;            // столько неудач подряд — повод будить владельца
const ХРАНИМ = 14;           // дней истории

// предел — какой код ответа ещё считаем живым. У чужих API 401 значит
// «сервис работает, просто мы не представились» — это не авария.
function замер(url, host, предел) {
  const нач = Date.now();
  try {
    const res = $http.send({ url, method: "GET", timeout: 15,
      headers: host ? { Host: host } : {} });
    return { ok: res.statusCode > 0 && res.statusCode < (предел || 400), code: res.statusCode, ms: Date.now() - нач };
  } catch (err) {
    return { ok: false, code: 0, ms: Date.now() - нач, note: String(err).slice(0, 180) };
  }
}

function записать(app, target, r) {
  try {
    app.db().newQuery(`INSERT INTO uptime (id, target, ok, ms, code, note, created, updated)
      VALUES ({:id}, {:t}, {:ok}, {:ms}, {:code}, {:note}, {:at}, {:at})`)
      .bind({ id: $security.randomStringWithAlphabet(15, "abcdefghijklmnopqrstuvwxyz0123456789"),
        t: target, ok: r.ok ? 1 : 0, ms: r.ms, code: r.code, note: r.note || "",
        at: new Date().toISOString().replace("T", " ").slice(0, 23) + "Z" }).execute();
  } catch (err) { console.log("доступность: не записал", err); }
}

// Сообщаем только при смене состояния и только после трёх неудач подряд:
// одиночная осечка сети — обычное дело, будить из-за неё незачем.
function состояние(app, key) {
  try {
    const row = new DynamicModel({ value: "" });
    app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: key }).one(row);
    return String(row.value || "");
  } catch (_) { return ""; }
}
function запомнить(app, key, v) {
  try {
    app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:t})
      ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:t}`)
      .bind({ k: key, v: String(v), t: new Date().toISOString() }).execute();
  } catch (_) {}
}

function проверить(app) {
  const s = shop.settings(app);
  const домен = String(s.get("site_url") || "https://venikoff.net").replace(/\/$/, "");

  const цели = [
    // сам магазин: Caddy → PocketBase → база
    ["сайт", () => замер(`${домен}/api/shop/ping`)],
    // Запасной вход через Нидерланды. Без заголовка Host: Go его всё равно
    // выбрасывает, и проверка падала. Стучимся по голому адресу на http —
    // ответ «308, идите на https» приходит уже от нашего Caddy, а значит
    // проброс через Нидерланды жив. Сертификат при этом не мешает.
    ["запасной вход", () => замер("http://66.151.33.159/api/shop/ping")],
    // банк: без него нечем принять оплату, а заказы продолжают оформляться
    ["банк", () => замер("https://api.cloudpayments.ru/", "", 500)],
    // склад: без него заказы копятся в очереди и флорист их не видит
    ["склад", () => замер("https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1", "", 500)],
  ];

  const итог = [];
  цели.forEach(([имя, сделать]) => {
    const r = сделать();
    записать(app, имя, r);
    итог.push(`${имя}: ${r.ok ? r.ms + " мс" : "НЕ ОТВЕЧАЕТ (" + (r.code || r.note || "нет связи") + ")"}`);

    const ключ = "up:" + имя;
    const было = состояние(app, ключ);
    const подряд = r.ok ? 0 : (+((было.match(/^bad:(\d+)/) || [])[1] || 0) + 1);
    if (r.ok) {
      if (было.indexOf("bad:") === 0 && +((было.match(/^bad:(\d+)/) || [])[1] || 0) >= ПОДРЯД) {
        сказать(app, s, `✅ «${имя}» снова отвечает.`);
      }
      запомнить(app, ключ, "ok");
    } else {
      запомнить(app, ключ, "bad:" + подряд);
      if (подряд === ПОДРЯД) {
        const что = {
          "сайт": "Покупатели не могут открыть магазин. Это авария.",
          "запасной вход": "Лёг сервер в Нидерландах. Те, у кого не работает прямой маршрут, остались без сайта.",
          "банк": "CloudPayments не отвечает — оплату картой не принять. Заказы будут копиться неоплаченными.",
          "склад": "МойСклад не отвечает — заказы не уезжают, флорист их не увидит. Накопятся в очереди и уйдут, когда склад оживёт.",
        }[имя] || "";
        сказать(app, s, `🔴 «${имя}» не отвечает три проверки подряд (${r.code || "нет связи"}).\n\n${что}`);
      }
    }
  });

  // чистим старое, чтобы журнал не рос бесконечно
  try {
    app.db().newQuery("DELETE FROM uptime WHERE created < {:t}")
      .bind({ t: new Date(Date.now() - ХРАНИМ * 864e5).toISOString().replace("T", " ").slice(0, 23) + "Z" }).execute();
  } catch (_) {}
  return итог;
}

function сказать(app, s, text) {
  try {
    const token = s.get("tg_token");
    shop.adminIds(s).forEach((c) => shop.tg(token, "sendMessage", { chat_id: c, text }));
  } catch (_) {}
}

// Сводка для админки: доля удачных проверок и средний отклик по целям
function сводка(app, часов) {
  const h = Math.min(720, Math.max(1, +часов || 24));
  const из = new Date(Date.now() - h * 3600e3).toISOString().replace("T", " ").slice(0, 23) + "Z";
  const out = [];
  try {
    const rows = arrayOf(new DynamicModel({ target: "", n: 0, bad: 0, avg: 0.0, worst: 0 }));
    app.db().newQuery(`SELECT target, COUNT(*) AS n,
        SUM(CASE WHEN ok THEN 0 ELSE 1 END) AS bad,
        CAST(ROUND(AVG(CASE WHEN ok THEN ms END)) AS INTEGER) AS avg,
        MAX(CASE WHEN ok THEN ms ELSE 0 END) AS worst
      FROM uptime WHERE created > {:f} GROUP BY target`).bind({ f: из }).all(rows);
    rows.forEach((r) => out.push({
      target: r.target, проверок: +r.n, неудач: +r.bad,
      доступность: +r.n ? Math.round((1 - r.bad / r.n) * 10000) / 100 : null,
      средний: Math.round(+r.avg || 0), худший: +r.worst,
    }));
  } catch (err) { console.log("доступность: сводка", err); }
  return out;
}

module.exports = { проверить, сводка };
