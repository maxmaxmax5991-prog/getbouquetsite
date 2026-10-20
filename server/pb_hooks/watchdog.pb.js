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

  // 1. Боты читают входящие? Отметка обновляется, когда Телеграм ответил на опрос.
  //
  // Речь именно о ЧТЕНИИ. Уведомления и ответы покупателям мы отправляем отдельными
  // запросами, и они уходят, даже когда опрос стоит. Старый текст пугал зря: 04.10
  // в 18:10 пришло «сообщения покупателям не доходят», хотя доходили.
  //
  // Порог 15 минут, а не 6: опрос держит соединение 45 секунд и из-за замка
  // запускается примерно раз в две минуты, так что шесть минут — это всего три
  // цикла. Одной заминки у Телеграма хватало на ложную тревогу.
  [["tg_beat", "Служебный бот", "кнопки и ответы в нём сейчас не срабатывают"],
   ["tg_beat_client", "Клиентский бот", "покупатели пишут, а мы их сообщений не видим"],
   ["max_beat", "Бот MAX", "сообщения покупателей из MAX сейчас не читаются"]].forEach(([field, name, что]) => {
    const on = field === "max_beat" ? !!s.get("max_token")
      : field === "tg_beat_client" ? !!s.get("tg_client_token") : true;
    if (!on) return;
    const beat = +s.get(field) || 0;
    const bad = !beat || Date.now() - beat > 15 * 60000;
    check(`bot:${field}`, bad ? `${name} не читает входящие уже ${beat ? mins(beat) + " мин" : "с перезапуска"} — ${что}. Уведомления и ответы при этом уходят как обычно.` : "",
      `${name} снова читает входящие.`);
  });

  // 2. Оплачено, но в МойСклад не уехало — флорист такого заказа не видит.
  //
  // ЭТА ТРЕВОГА УЖЕ БЫЛА И НЕ ПОМОГЛА. 07.10 в 17:01 встал заказ №3778, за ним
  // ещё восемь, и уехали они только в 12:20 следующего дня — 17 часов не той
  // задержки, про которую покупателю скажешь «вот-вот». Сторож честно писал в
  // бот с вечера, но сообщение было одно в общем потоке, рядом с вечными «фото
  // не ушло» по заказу от 26 сентября. На такой фон перестают смотреть.
  //
  // Поэтому здесь: отдельный текст с последствием, а не «отправьте вручную»;
  // возраст самого старого заказа прямо в строке; и повтор каждый час, пока не
  // починено, — ключ тревоги меняется вместе с часом ожидания, поэтому `check`
  // считает это новой бедой и пишет снова.
  try {
    const t15 = new Date(Date.now() - 15 * 60000).toISOString().replace("T", " ").slice(0, 19);
    const stuck = $app.findRecordsByFilter("orders",
      `payment_status = "paid" && ms_id = "" && status != "cancelled" && created < {:t}`,
      "created", 20, 0, { t: t15 });
    let текст = "";
    if (stuck.length) {
      const ждёт = mins(Date.parse(String(stuck[0].get("created")).replace(" ", "T")));
      const часы = Math.floor(ждёт / 60);
      const срок = часы >= 1 ? `${часы} ч ${ждёт % 60} мин` : `${ждёт} мин`;
      // Час ожидания входит в текст, поэтому каждый новый час `check` видит
      // другую беду и пишет снова. Без этого сообщение приходило один раз за
      // всю ночь — ровно так 17 часов простоя и остались незамеченными.
      текст = `🛑 Заказы оплачены, но их НЕТ в МоёмСкладе — флорист их не видит и не собирает.`
        + `\n\nЖдут: ${stuck.map((o) => "№" + o.get("number")).join(", ")}.`
        + `\nСамый старый ждёт уже ${срок}.`
        + `\n\nАдминка → Заказы → кнопка «В МоёмСкладе» у заказа. Жалуется на номенклатуру — значит сорт не заведён на складе.`;
    }
    check("ms:stuck", текст, "Все оплаченные заказы доехали до МоегоСклада.");
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

  // 2в. Доставка в МоёмСкладе без оплаты — такого быть не может: доставка уходит
  // туда только после платежа. Если случилось — где-то потерялись деньги.
  try {
    const bad = $app.findRecordsByFilter("orders",
      `delivery_type = "delivery" && payment_status != "paid" && ms_id != "" && status != "cancelled"`,
      "-created", 20, 0);
    check("pay:delivery", bad.length
      ? `Доставка в МоёмСкладе без оплаты: ${bad.map((o) => "№" + o.get("number")).join(", ")}. Проверьте платёж, прежде чем отдавать курьеру.`
      : "", "Неоплаченных доставок нет.");
  } catch (err) { console.log("watchdog paydelivery", err); }

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

  // 3б. В чате на сайте ждут ответа.
  //
  // Порог три минуты, а не пятнадцать: владелец считает это временем, за
  // которое покупателю обязаны ответить. И называем не только покупателя, но и
  // ТОГО, КТО ДОЛЖЕН БЫЛ ОТВЕТИТЬ, — иначе тревога ни на кого не указывает и
  // разбираться по ней невозможно.
  //
  // Ответственного ищем по порядку: кто последним отвечал в этом диалоге →
  // кто ведёт свежий заказ этого покупателя → «ничей».
  //
  // Только в рабочие часы, 8:00–00:00 по Москве: ночью будить некого, а
  // ночная тревога обесценивает дневные.
  try {
    const мск = new Date(Date.now() + 3 * 3600e3).getUTCHours();
    const рабочее = мск >= 8;            // 8:00–23:59 МСК
    const waiting = рабочее ? $app.findRecordsByFilter("chats",
      `answered = false && unread > 0 && last_at < {:t}`, "last_at", 20, 0,
      { t: new Date(Date.now() - 3 * 60000).toISOString() }) : [];

    const имяМенеджера = (id) => { try { const m = $app.findRecordById("managers", id); return m.get("name") || m.get("nick") || "кто-то"; } catch (_) { return "кто-то"; } };
    const ктоДолжен = (c) => {
      try {
        const пред = $app.findRecordsByFilter("chat_messages",
          `chat = {:c} && side = "shop" && author != ""`, "-created", 1, 0, { c: c.id });
        if (пред.length) return имяМенеджера(пред[0].get("author"));
      } catch (_) {}
      try {
        if (c.get("customer")) {
          const o = $app.findRecordsByFilter("orders",
            `customer = {:k} && manager != "" && status != "cancelled"`, "-created", 1, 0, { k: c.get("customer") });
          if (o.length) return имяМенеджера(o[0].get("manager"));
        }
      } catch (_) {}
      return "никто не закреплён";
    };
    const мин = (c) => Math.max(0, Math.round((Date.now() - Date.parse(c.get("last_at") || "")) / 60000));

    check("chat:wait", waiting.length
      ? `⏰ Не ответили покупателю дольше 3 минут:\n\n${waiting.map((c) =>
          `• ${c.get("name") || c.get("phone") || "гость"} — ждёт ${мин(c)} мин, отвечать: ${ктоДолжен(c)}`).join("\n")}\n\nАдминка → Чат.`
      : "", "В чате все ответы даны.");
  } catch (err) { console.log("watchdog chat", err); }

  // 3в. Букет собран или уже едет, а фото клиенту не отправили
  try {
    // Только свежие: в списке висел заказ №3041 от 26.09, и из-за таких
    // «вечных» строк тревога меняла текст месяцами, а читать её перестали.
    const noPhoto = $app.findRecordsByFilter("orders",
      `(status = "photo" || status = "delivering") && photo_file_id = "" && (tg_chat != "" || max_chat != "") && created > {:d}`,
      "-created", 20, 0, { d: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) });
    check("photo:none", noPhoto.length
      ? `Букет собран, а фото клиенту не ушло: ${noPhoto.map((o) => "№" + o.get("number")).join(", ")}. Пришлите фото в бот с подписью-номером.`
      : "", "По всем собранным букетам фото отправлено.");
  } catch (err) { console.log("watchdog nophoto", err); }

  // 4. Фото букета отправлено, а покупатель не ответил больше двух часов
  try {
    // Тоже только свежие — по той же причине.
    const silent = $app.findRecordsByFilter("orders",
      `photo_status = "waiting" && updated < {:t} && status != "done" && status != "cancelled" && created > {:d}`,
      "updated", 10, 0, { t: new Date(Date.now() - 120 * 60000).toISOString().replace("T", " ").slice(0, 19),
        d: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19) });
    check("photo:silent", silent.length
      ? `Покупатель не ответил на фото больше двух часов: ${silent.map((o) => `№${o.get("number")} (${o.get("phone")})`).join(", ")}. Лучше позвонить.`
      : "", "На все фото покупатели ответили.");
  } catch (err) { console.log("watchdog photo", err); }
});
