// Звонок по горячему следу: заказ картой не оплачен пять минут — зовём звонить.
//
// Почему именно пять: из 1 927 оплат за месяц 74 % проходят за две минуты и
// 92 % — за пять. Кто не заплатил к пятой минуте, в большинстве уже не
// заплатит сам: за 30 дней таких набралось 422 заказа на 3,2 млн ₽, и 411 из
// них — люди, которые заказывали у нас впервые. Телефон есть у всех, бот —
// почти ни у кого, поэтому единственный живой способ их вернуть — позвонить,
// пока человек ещё за экраном.
const shop = require(`${__hooks}/lib/shop.js`);

const ПОРОГ = 5;          // минут по умолчанию
const ОКНО = 60;          // позже этого сигнал уже не зовём: поздно

const ИТОГИ = {
  promised: "обещал оплатить", later: "перезвонить позже", refused: "отказался",
  noanswer: "не берёт трубку", wrong: "номер не тот",
  // «Дубль» — человек натыкал несколько заказов подряд. Звонить не надо, но и
  // отменять заказ кнопкой из чата мы не будем: через час машинка напоминаний
  // погасит его сама и вернёт стебли на склад. Кнопка нужна ровно чтобы
  // карточка погасла у ВСЕХ и никто по ней больше не звонил.
  double: "дубль, не звоним",
};

const ОКНО_ДУБЛЕЙ = 15;   // минут: в пределах этого считаем заказы одной попыткой

function минут(o) {
  const t = Date.parse(String(o.getString("created") || "").replace(" ", "T").replace(/Z?$/, "Z"));
  return t ? (Date.now() - t) / 60000 : 0;
}

// Первый ли заказ у этого телефона. Повторные доплачивают почти всегда,
// дёргать менеджера ради них не надо.
function впервые(app, o) {
  const хвост = String(o.get("phone") || "").replace(/\D/g, "").slice(-10);
  if (хвост.length !== 10) return true;
  try {
    return !app.findRecordsByFilter("orders", `payment_status = "paid" && phone ~ {:t} && created < {:c}`,
      "-created", 1, 0, { t: хвост, c: o.getString("created") }).length;
  } catch (_) { return true; }
}

// Сколько заказов этот телефон оформил рядом по времени и оплачен ли хоть один.
// Человек жмёт «Оплатить», возвращается, жмёт ещё раз — и у нас три заказа на
// одну покупку. Менеджер звонил по каждому и выяснял, что деньги уже прошли.
function рядом(app, o) {
  const хвост = String(o.get("phone") || "").replace(/\D/g, "").slice(-10);
  if (хвост.length !== 10) return null;
  const t = Date.parse(String(o.getString("created") || "").replace(" ", "T").replace(/Z?$/, "Z"));
  if (!t) return null;
  const метка = (ms) => new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";
  let список = [];
  try {
    список = app.findRecordsByFilter("orders",
      `phone ~ {:t} && created >= {:a} && created <= {:b} && status != "cancelled"`,
      "created", 20, 0,
      { t: хвост, a: метка(t - ОКНО_ДУБЛЕЙ * 60000), b: метка(t + ОКНО_ДУБЛЕЙ * 60000) });
  } catch (err) { console.log("звонок: соседние заказы", err); return null; }
  if (список.length < 2) return null;
  const оплачен = список.find((x) => x.get("payment_status") === "paid");
  return {
    всего: список.length,
    номера: список.map((x) => "№" + x.get("number")).join(", "),
    оплачен: оплачен ? { номер: оплачен.get("number"), сумма: shop.rub(оплачен.get("total") || 0) } : null,
  };
}

// Куда слать сигнал. Если заведён отдельный бот под обзвон — в него и его
// чаты; иначе по-старому, в служебный бот владельцу и наблюдателям.
function адресаты(app, s) {
  const свой = String(s.get("call_token") || "").trim();
  if (свой) {
    return { token: свой, кому: разбор(s.get("call_chats")), свой: true };
  }
  return { token: s.get("tg_token"), кому: shop.adminIds(s), свой: false };
}

function проверить(app) {
  const s = shop.settings(app);
  const порог = Math.max(1, +s.get("call_after") || ПОРОГ);
  let список = [];
  try {
    список = app.findRecordsByFilter("orders",
      `payment_method = "card" && payment_status != "paid" && status != "cancelled" && call_alert != true`,
      "-created", 30, 0);
  } catch (err) { console.log("звонок: не прочитал заказы", err); return { позвали: 0 }; }

  const { token, кому } = адресаты(app, s);
  if (!token || !кому.length) return { позвали: 0 };
  let позвали = 0;
  список.forEach((o) => {
    const м = минут(o);
    if (м < порог || м > ОКНО) return;
    const телефон = String(o.get("phone") || "");
    const сумма = shop.rub(o.get("total") || 0);
    const новый = впервые(app, o);
    const отказ = String(o.get("pay_error") || "");
    const соседи = рядом(app, o);
    const текст = [
      `🔴 Не оплачен ${Math.round(м)} минут — позвоните сейчас`,
      // Пустая строка-разделитель съедалась filter(Boolean), и шапка слипалась
      // с заказом. Переносы вешаем на сами строки.
      `\nЗаказ №${o.get("number")} · ${сумма}`,
      `${o.get("name") || "без имени"} · ${телефон}`,
      новый ? "Заказывает у нас ВПЕРВЫЕ" : "Уже заказывал раньше",
      отказ ? `Банк: ${отказ}` : "",
      // Сначала про оплату, потом про количество: если деньги уже прошли,
      // остальное менеджеру читать незачем — звонить просто не надо.
      соседи && соседи.оплачен
        ? `\n✅ ОДИН ИЗ НИХ УЖЕ ОПЛАЧЕН — №${соседи.оплачен.номер} на ${соседи.оплачен.сумма}.\nПохоже, это дубль: звонить не нужно.`
        : "",
      соседи
        ? `🧩 За ${ОКНО_ДУБЛЕЙ} минут с этого номера ${соседи.всего} ${скл(соседи.всего, "заказ", "заказа", "заказов")}: ${соседи.номера}`
        : "",
      `\n${o.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${show(o)}`,
    ].filter(Boolean).join("\n");
    const кнопки = { inline_keyboard: [
      [{ text: "✅ Обещал оплатить", callback_data: `pc:promised:${o.id}` }],
      [{ text: "⏳ Позже", callback_data: `pc:later:${o.id}` }, { text: "📵 Не берёт", callback_data: `pc:noanswer:${o.id}` }],
      [{ text: "✖ Отказался", callback_data: `pc:refused:${o.id}` }, { text: "❌ Номер не тот", callback_data: `pc:wrong:${o.id}` }],
      [{ text: "🧩 Дубль — не звонить", callback_data: `pc:double:${o.id}` }],
    ] };
    // Запоминаем, где легла карточка: кнопку нажмёт один, а погасить её надо
    // у всех, иначе остальные позвонят тому же человеку ещё раз.
    const куда = [];
    кому.forEach((c) => {
      const r = shop.tg(token, "sendMessage", { chat_id: c, text: текст, reply_markup: кнопки });
      const id = r && r.ok && r.result && r.result.message_id;
      if (id) куда.push({ c: String(c), m: id });
    });
    // запросом, мимо хуков: обычное сохранение заказа будит уведомления и склад
    try {
      // Храним и сам текст: править карточку в чужом чате надо целиком,
      // а взять её текст оттуда неоткуда — Телеграм его не отдаёт.
      const запись = JSON.stringify({ t: текст, w: куда });
      app.db().newQuery("UPDATE orders SET call_alert = true, call_msgs = {:m} WHERE id = {:id}")
        .bind({ m: запись.length > 2000 ? JSON.stringify({ t: "", w: куда }) : запись, id: o.id }).execute();
      позвали++;
    } catch (err) { console.log("звонок: не отметил", o.id, err); }
  });
  return { позвали };
}

function show(o) {
  try { return shop.whenText(o); } catch (_) { return ""; }
}

// Менеджер нажал кнопку под сигналом
function итогЗвонка(app, orderId, итог, кто) {
  if (!ИТОГИ[итог]) return null;
  let o;
  try { o = app.findRecordById("orders", String(orderId)); } catch (_) { return null; }
  try {
    app.db().newQuery("UPDATE orders SET call_result = {:r}, call_at = {:a}, call_by = {:b} WHERE id = {:id}")
      .bind({ r: итог, a: new Date().toISOString(), b: String(кто || "").slice(0, 40), id: o.id }).execute();
  } catch (err) { console.log("звонок: не записал итог", err); return null; }
  try { require(`${__hooks}/lib/staff.js`).запись(app, o, null, "звонок по оплате", ИТОГИ[итог]); } catch (_) {}
  let карточки = [], текст = "";
  try {
    const v = JSON.parse(o.getString("call_msgs") || "{}");
    if (Array.isArray(v)) карточки = v;                       // старая запись: только адреса
    else if (v && Array.isArray(v.w)) { карточки = v.w; текст = String(v.t || ""); }
  } catch (_) {}
  return { номер: o.get("number"), подпись: ИТОГИ[итог], карточки, текст };
}

// Склонение числа заказов: «3 заказа», а не «3 заказов».
function скл(n, одна, две, много) {
  const a = Math.abs(Math.round(n)) % 100, b = a % 10;
  if (a > 10 && a < 20) return много;
  if (b > 1 && b < 5) return две;
  return b === 1 ? одна : много;
}

// Погасить карточку заказа во ВСЕХ чатах, куда она ушла.
// Итог может прийти из двух мест — кнопкой в боте и выбором в админке, —
// а карточка в Телеграме одна и та же, и висеть неотвеченной она не должна
// ни в одном из случаев: иначе второй менеджер позвонит тому же человеку.
// editMessageText без reply_markup заодно убирает кнопки.
function погасить(app, r, итог, кто, своё) {
  if (!r || !r.карточки) return 0;
  const s = shop.settings(app);
  const token = String(s.get("call_token") || "").trim();
  if (!token) return 0;
  const хвост = `\n\n— ${r.подпись}${кто ? `, ${кто}` : ""}`
    + (итог === "promised" ? "\nДержим букет ещё 3 часа." : "")
    + (итог === "double" ? "\nЗвонить не нужно. Заказ погаснет сам через час, стебли вернутся на склад." : "");
  const тело = r.текст || (своё && своё.текст) || `Заказ №${r.номер} — не оплачен`;
  const где = (r.карточки || []).slice();
  // Своя карточка могла уйти ещё до того, как мы начали запоминать адреса.
  if (своё && своё.чат && !где.some((x) => String(x.c) === String(своё.чат) && x.m === своё.сообщение)) {
    где.push({ c: String(своё.чат), m: своё.сообщение });
  }
  let n = 0;
  где.forEach((x) => {
    shop.tg(token, "editMessageText", { chat_id: x.c, message_id: x.m, text: `${тело}${хвост}` });
    n++;
  });
  return n;
}

// Опрос бота обзвона: ловим нажатия кнопок под сигналом. У служебного бота
// свой опрос, этот живёт отдельно — иначе пришлось бы отдавать чужому боту
// права на товары и остатки.
function опрос(app) {
  const s = shop.settings(app);
  const token = String(s.get("call_token") || "").trim();
  if (!token) return { обработано: 0 };
  let offset = +s.get("call_offset") || 0;
  let обработано = 0;
  const до = Date.now() + 45000;
  while (Date.now() < до) {
    const ждать = Math.max(1, Math.min(20, Math.round((до - Date.now()) / 1000) - 5));
    let res;
    try {
      res = $http.send({ url: `https://api.telegram.org/bot${token}/getUpdates?timeout=${ждать}&offset=${offset}&allowed_updates=["message","callback_query"]`,
        method: "GET", timeout: ждать + 10 });
    } catch (_) { return { обработано }; }
    if (res.statusCode === 409) {
      $http.send({ url: `https://api.telegram.org/bot${token}/deleteWebhook`, method: "POST", timeout: 15 });
      continue;
    }
    if (res.statusCode !== 200 || !res.json || !res.json.ok) return { обработано };
    const список = res.json.result || [];
    for (const upd of список) {
      offset = upd.update_id + 1;
      try { app.db().newQuery("UPDATE settings SET call_offset = {:v} WHERE id = {:id}").bind({ v: offset, id: s.id }).execute(); } catch (_) {}
      try { обработать(app, s, token, upd); обработано++; } catch (err) { console.log("бот обзвона", err); }
    }
  }
  return { обработано };
}

function обработать(app, s, token, upd) {
  if (upd.callback_query) {
    const cb = upd.callback_query;
    const части = String(cb.data || "").split(":");
    if (части[0] !== "pc") return shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id });
    const кто = cb.from.first_name || cb.from.username || "";
    const r = итогЗвонка(app, части[2], части[1], кто);
    shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: r ? r.подпись : "Не записал" });
    if (r) погасить(app, r, части[1], кто,
      { чат: cb.message.chat.id, сообщение: cb.message.message_id, текст: cb.message.text });
    return;
  }
  const m = upd.message;
  if (!m || !m.text) return;
  const чат = String(m.chat.id);
  const имя = [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(" ")
    || (m.from && m.from.username) || "без имени";
  const было = разбор(s.get("call_chats"));
  if (было.indexOf(чат) >= 0) {
    return shop.tg(token, "sendMessage", { chat_id: чат, text: "Вы уже подключены — сигналы о неоплаченных заказах приходят сюда." });
  }
  // Подключаем сразу всех, кто написал (решение владельца 06.11.2026). Раньше
  // все, кроме первого, ждали подтверждения в админке — и молча не получали
  // ничего. Ссылку на бота дают только своим, поэтому сторожить вход незачем.
  было.push(чат);
  try {
    app.db().newQuery("UPDATE settings SET call_chats = {:v} WHERE id = {:id}")
      .bind({ v: было.join(","), id: s.id }).execute();
  } catch (err) { console.log("бот обзвона: не подключил", чат, err); }
  // Владельцу всё равно говорим, кто подключился: бот открыт, но знать, кто в
  // нём сидит, он должен.
  try {
    shop.adminIds(s).forEach((c) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: c,
      text: `🔔 ${имя} подключился к боту обзвона. Всего получателей: ${было.length}.\nУбрать — Настройки → «Бот для обзвона».` }));
  } catch (_) {}
  shop.tg(token, "sendMessage", { chat_id: чат,
    text: `Готово, ${имя}. Сюда будут приходить заказы, не оплаченные пять минут: имя, телефон и кнопки для итога звонка.` });
}

const разбор = (v) => String(v || "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);

// Вечером чат на сайте ведут те же люди, что обзванивают неоплаченные заказы, и
// служебный бот у них не открыт. С 20:00 до полуночи по Москве сообщения из
// чата дублируются в бот обзвона. Часы правятся в настройках, 20 → 0 значит
// «с восьми вечера до полуночи»; равные часы выключают пересылку.
function чатВечером(app, s) {
  const нас = s || shop.settings(app);
  const token = String(нас.get("call_token") || "").trim();
  const кому = разбор(нас.get("call_chats"));
  if (!token || !кому.length) return null;
  const с = Math.min(23, Math.max(0, +нас.get("call_chat_from") || 0));
  const по = Math.min(24, Math.max(0, +нас.get("call_chat_to") || 0));
  if (с === по) return null;
  const час = new Date(Date.now() + 3 * 3600 * 1000).getUTCHours();   // Москва
  const внутри = с < по ? (час >= с && час < по) : (час >= с || час < по);
  return внутри ? { token, кому } : null;
}

// Сообщение покупателя в бот обзвона — ровно тем же текстом, что видит
// служебный бот, но без метки [chat:…]: ответить реплаем через чужой бот нельзя.
function чатСигнал(app, кто, текст, откуда) {
  try {
    const n = чатВечером(app);
    if (!n) return false;
    const где = откуда === "tg" ? "Телеграм" : откуда === "max" ? "MAX" : "чат на сайте";
    const t = `💬 ${где} — ${кто}\n\n«${String(текст || "прислал фото").slice(0, 900)}»\n\nОтвечаем из админки, вкладка «Чат».`;
    n.кому.forEach((c) => shop.tg(n.token, "sendMessage", { chat_id: c, text: t }));
    return true;
  } catch (err) { console.log("чат в бот обзвона", err); return false; }
}
function заявкиСписок(s) {
  try { const v = JSON.parse(s.getString("call_pending") || "[]"); return Array.isArray(v) ? v : []; }
  catch (_) { return []; }
}

module.exports = { проверить, итогЗвонка, погасить, опрос, адресаты, заявкиСписок, разбор, чатВечером, чатСигнал, ИТОГИ };
