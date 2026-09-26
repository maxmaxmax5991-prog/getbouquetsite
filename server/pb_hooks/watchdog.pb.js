/// <reference path="../pb_data/types.d.ts" />
// Сторож. Раз в 10 минут проверяет то, что уже ломалось, и пишет владельцу
// в служебный бот. Про одну и ту же беду сообщает один раз — и отдельно
// сообщает, когда она прошла, чтобы не гадать, починилось или нет.
//
// Внимание: обработчики PocketBase не видят код верхнего уровня — всё пишем внутри задания.
cronAdd("watchdog", "*/10 * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);

  let s;
  try { s = shop.settings($app); } catch (_) { return; }
  const token = s.get("tg_token");
  if (!token) return;

  // Состояние тревоги: сообщаем только когда оно изменилось
  const was = (key) => {
    try {
      const row = new DynamicModel({ value: "" });
      $app.db().newQuery("SELECT value FROM watchdog_state WHERE key = {:k}").bind({ k: key }).one(row);
      return String(row.value || "");
    } catch (_) { return ""; }
  };
  const remember = (key, value) => {
    try {
      $app.db().newQuery(`INSERT INTO watchdog_state (key, value, at) VALUES ({:k}, {:v}, {:t})
        ON CONFLICT(key) DO UPDATE SET value = {:v}, at = {:t}`)
        .bind({ k: key, v: value, t: new Date().toISOString() }).execute();
    } catch (err) { console.log("watchdog state", err); }
  };
  const tell = (text) => shop.adminIds(s).forEach((chat) => shop.tg(token, "sendMessage", { chat_id: chat, text }));
  // problem — текст беды или "" если всё хорошо
  const check = (key, problem, ok) => {
    const prev = was(key);
    const now = problem || "";
    if (now === prev) return;
    remember(key, now);
    if (now) tell(`⚠️ ${now}`);
    else if (prev) tell(`✅ ${ok}`);
  };

  const mins = (ms) => Math.round((Date.now() - ms) / 60000);

  // 1. Боты отвечают? Опрос идёт непрерывно, отметка обновляется каждые 20 секунд.
  [["tg_beat", "служебный бот"], ["tg_beat_client", "клиентский бот"], ["max_beat", "бот MAX"]].forEach(([field, name]) => {
    const on = field === "max_beat" ? !!s.get("max_token")
      : field === "tg_beat_client" ? !!s.get("tg_client_token") : true;
    if (!on) return;
    const beat = +s.get(field) || 0;
    const bad = !beat || Date.now() - beat > 6 * 60000;
    check(`bot:${field}`, bad ? `${name} молчит уже ${beat ? mins(beat) + " мин" : "с перезапуска"}. Сообщения покупателям сейчас не доходят.` : "",
      `${name} снова отвечает.`);
  });

  // 2. Оплачено, но в МойСклад не уехало — флорист такого заказа не увидит
  try {
    const stuck = $app.findRecordsByFilter("orders",
      `payment_status = "paid" && ms_id = "" && status != "cancelled" && created < {:t}`,
      "created", 20, 0, { t: new Date(Date.now() - 15 * 60000).toISOString().replace("T", " ").slice(0, 19) });
    check("ms:stuck", stuck.length
      ? `Оплачено, но не ушло в МойСклад: ${stuck.map((o) => "№" + o.get("number")).join(", ")}. Отправьте вручную из админки.`
      : "", "Все оплаченные заказы в МоёмСкладе.");
  } catch (err) { console.log("watchdog stuck", err); }

  // 2б. Оплачено, заказ в МоёмСкладе есть, а входящего платежа нет
  try {
    const noPay = $app.findRecordsByFilter("orders",
      `payment_status = "paid" && ms_id != "" && ms_payment_id = "" && created < {:t}`,
      "created", 20, 0, { t: new Date(Date.now() - 30 * 60000).toISOString().replace("T", " ").slice(0, 19) });
    check("ms:nopay", noPay.length
      ? `Оплачено, но платёж не проведён в МоёмСкладе: ${noPay.map((o) => "№" + o.get("number")).join(", ")}. Проведите вручную.`
      : "", "Все оплаты проведены в МоёмСкладе.");
  } catch (err) { console.log("watchdog nopay", err); }

  // 3. Дубли в МоёмСкладе — два одинаковых заказа означают двойную отгрузку
  try {
    if (s.get("ms_enabled") && s.get("ms_token")) {
      const msl = require(`${__hooks}/lib/ms.js`);
      const ch = msl.channelId(s);
      if (ch) {
        const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", "%20");
        const href = `https://api.moysklad.ru/api/remap/1.2/entity/saleschannel/${ch}`;
        // знаки =, ; и >= внутри filter кодируем, двоеточие и косые в адресе — нет,
        // иначе МойСклад отвечает списком всех заказов подряд
        const q = `/entity/customerorder?limit=100&filter=salesChannel%3D${href}%3Bcreated%3E%3D${since}`;
        const r = msl.ms(s, "GET", q);
        if (r.ok && r.data && r.data.rows) {
          const seen = {}, dup = [];
          r.data.rows.forEach((o) => {
            const n = String(o.name || "");
            if (seen[n]) { if (dup.indexOf(n) < 0) dup.push(n); } else seen[n] = 1;
          });
          check("ms:dup", dup.length
            ? `В МоёмСкладе задвоились заказы: ${dup.join(", ")}. Удалите лишний, пока не отгрузили дважды.`
            : "", "Дублей в МоёмСкладе больше нет.");
        }
      }
    }
  } catch (err) { console.log("watchdog dup", err); }

  // 3б. В чате на сайте ждут ответа
  try {
    const waiting = $app.findRecordsByFilter("chats",
      `answered = false && unread > 0 && last_at < {:t}`, "last_at", 20, 0,
      { t: new Date(Date.now() - 15 * 60000).toISOString() });
    check("chat:wait", waiting.length
      ? `В чате на сайте ждут ответа больше 15 минут: ${waiting.map((c) => c.get("name") || c.get("phone") || "гость").join(", ")}. Откройте админку → Чат.`
      : "", "В чате все ответы даны.");
  } catch (err) { console.log("watchdog chat", err); }

  // 4. Фото букета отправлено, а покупатель не ответил больше двух часов
  try {
    const silent = $app.findRecordsByFilter("orders",
      `photo_status = "waiting" && updated < {:t} && status != "done" && status != "cancelled"`,
      "updated", 10, 0, { t: new Date(Date.now() - 120 * 60000).toISOString().replace("T", " ").slice(0, 19) });
    check("photo:silent", silent.length
      ? `Покупатель не ответил на фото больше двух часов: ${silent.map((o) => `№${o.get("number")} (${o.get("phone")})`).join(", ")}. Лучше позвонить.`
      : "", "На все фото покупатели ответили.");
  } catch (err) { console.log("watchdog photo", err); }
});
