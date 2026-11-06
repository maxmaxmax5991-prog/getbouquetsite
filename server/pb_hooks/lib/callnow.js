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
};

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
    const текст = [
      `🔴 Не оплачен ${Math.round(м)} минут — позвоните сейчас`,
      "",
      `Заказ №${o.get("number")} · ${сумма}`,
      `${o.get("name") || "без имени"} · ${телефон}`,
      новый ? "Заказывает у нас ВПЕРВЫЕ" : "Уже заказывал раньше",
      отказ ? `Банк: ${отказ}` : "",
      "",
      `${o.get("delivery_type") === "pickup" ? "Самовывоз" : "Доставка"}: ${show(o)}`,
    ].filter(Boolean).join("\n");
    const кнопки = { inline_keyboard: [
      [{ text: "✅ Обещал оплатить", callback_data: `pc:promised:${o.id}` }],
      [{ text: "⏳ Позже", callback_data: `pc:later:${o.id}` }, { text: "📵 Не берёт", callback_data: `pc:noanswer:${o.id}` }],
      [{ text: "✖ Отказался", callback_data: `pc:refused:${o.id}` }, { text: "❌ Номер не тот", callback_data: `pc:wrong:${o.id}` }],
    ] };
    кому.forEach((c) => shop.tg(token, "sendMessage", { chat_id: c, text: текст, reply_markup: кнопки }));
    // запросом, мимо хуков: обычное сохранение заказа будит уведомления и склад
    try {
      app.db().newQuery("UPDATE orders SET call_alert = true WHERE id = {:id}").bind({ id: o.id }).execute();
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
  return { номер: o.get("number"), подпись: ИТОГИ[итог] };
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
    const r = итогЗвонка(app, части[2], части[1], cb.from.first_name || cb.from.username || "");
    shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: r ? r.подпись : "Не записал" });
    if (r) {
      shop.tg(token, "editMessageText", { chat_id: cb.message.chat.id, message_id: cb.message.message_id,
        text: `${cb.message.text}\n\n— записано: ${r.подпись}${части[1] === "promised" ? "\nДержим букет ещё 3 часа." : ""}` });
    }
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

module.exports = { проверить, итогЗвонка, опрос, адресаты, заявкиСписок, разбор, чатВечером, чатСигнал, ИТОГИ };
