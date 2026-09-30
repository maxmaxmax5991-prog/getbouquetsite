// Оценка после вручения. Один вопрос: насколько готовы порекомендовать нас
// от 1 до 10. Ответ покупатель пишет цифрой — это работает одинаково в Телеграме
// и в MAX и не требует ни кнопок, ни второго шага.
// Раньше вопросов было три, с кнопками; из 120 опросов не ответил никто, потому
// что нажатия глотал обработчик. Заодно сократили: короткий опрос проходят чаще.
const shop = require(`${__hooks}/lib/shop.js`);

const ВОПРОС = "Насколько вы готовы порекомендовать нас друзьям — от 1 до 10?\n\nПросто напишите цифру в ответ.";

// 9–10 промоутеры, 7–8 нейтральные, 1–6 критики
const ПРОМОУТЕР = 9, КРИТИК = 6;

function via(app, o, rec) {
  const s = shop.settings(app);
  const isMax = rec.get("via") === "max";
  return {
    s,
    say(text, url) {
      if (isMax) {
        const mx = require(`${__hooks}/lib/max.js`);
        mx.send(s.get("max_token"), o.get("max_chat"), text, url ? [[mx.btnLink("Оставить отзыв", url)]] : null);
      } else {
        shop.tg(shop.clientToken(s, shop.brandOfOrder(app, o)), "sendMessage", {
          chat_id: o.get("tg_chat"), text,
          reply_markup: url ? { inline_keyboard: [[{ text: "⭐ Оставить отзыв на Яндекс.Картах", url }]] } : undefined,
        });
      }
    },
  };
}

function orderOf(app, rec) {
  try { return app.findRecordById("orders", rec.get("order")); } catch (_) { return null; }
}

// Задать вопрос
function ask(app, rec) {
  const o = orderOf(app, rec);
  if (!o) return;
  via(app, o, rec).say(`Заказ №${o.get("number")} доставлен 🌸\n\n${ВОПРОС}`);
}

// Завести опрос после вручения — один раз на заказ
function start(app, o) {
  if (!o.get("tg_chat") && !o.get("max_chat")) return;
  try { app.findFirstRecordByFilter("reviews", "order = {:o}", { o: o.id }); return; } catch (_) {}
  const rec = new Record(app.findCollectionByNameOrId("reviews"));
  rec.set("order", o.id);
  if (o.get("customer")) rec.set("customer", o.get("customer"));
  rec.set("step", "nps");
  rec.set("via", o.get("tg_chat") ? "tg" : "max");
  app.save(rec);
  ask(app, rec);
}

// Цифра из ответа. «10», «9!», «десятка из десяти» — берём первое число 1..10.
// Первым делом пробуем весь ответ целиком: так «10» не превратится в «1».
function числоИз(text) {
  const t = String(text || "").trim();
  const целиком = t.match(/^(10|[1-9])$/);
  if (целиком) return +целиком[1];
  const внутри = t.match(/(?:^|[^\d])(10|[1-9])(?![\d])/);
  return внутри ? +внутри[1] : null;
}

// Ответ покупателя: цифра — это оценка, остальное — свободный отзыв.
// Отвечаем покупателю здесь же: боту остаётся только позвать эту функцию.
function reply(app, rec, text) {
  if (String(rec.get("step") || "") === "nps") {
    const n = числоИз(text);
    if (n !== null) return оценка(app, rec, n);
  }
  comment(app, rec, text);
  const o = orderOf(app, rec);
  if (o) via(app, o, rec).say("Спасибо, передали. Нам это правда важно.");
}

function оценка(app, rec, n) {
  const o = orderOf(app, rec);
  rec.set("nps", n);
  rec.set("step", n >= ПРОМОУТЕР ? "done" : "comment");   // у остальных ещё спросим, что поправить
  if (n <= КРИТИК) rec.set("needs_call", true);
  app.save(rec);
  if (!o) return "Спасибо!";

  const s = shop.settings(app);
  const ch = via(app, o, rec);

  if (n >= ПРОМОУТЕР) {
    const url = String(s.get("review_url") || "").trim();
    ch.say(url
      ? "Спасибо! Это лучшее, что может услышать цветочный магазин.\n\nЕсли не сложно, оставьте пару слов на Яндекс.Картах — маленькому магазину это очень помогает."
      : "Спасибо! Это лучшее, что может услышать цветочный магазин.", url || null);
    return "Спасибо!";
  }

  if (n <= КРИТИК) {
    ch.say("Спасибо за честность. Жаль, что не всё получилось — мы свяжемся с вами и разберёмся.\n\nЕсли хотите, напишите одним сообщением, что пошло не так.");
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `🔴 Оценка ${n} из 10 — заказ №${o.get("number")}\n${o.get("name")}, ${o.get("phone")}\n\nНужно позвонить.`,
      reply_markup: { inline_keyboard: [[{ text: "✅ Взял в работу", callback_data: `rh:${rec.id}` }]] } }));
    return "Спасибо, разберёмся.";
  }

  ch.say("Спасибо! Подскажите одним сообщением, чего не хватило до десятки — мы поправим.");
  return "Спасибо!";
}

// Свободный отзыв
function comment(app, rec, text) {
  rec.set("comment", String(text).slice(0, 1000));
  rec.set("step", "done");
  app.save(rec);
  try {
    const s = shop.settings(app);
    const o = orderOf(app, rec);
    const n = +rec.get("nps") || 0;
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `💬 Отзыв по заказу №${o ? o.get("number") : "?"}${n ? ` (оценка ${n} из 10)` : ""}: «${String(text).slice(0, 500)}»` }));
  } catch (_) {}
}

// Ждём ли от этого покупателя ответ: цифру или свободный отзыв.
// Идём ОТ ЗАКАЗОВ этого собеседника, а не от последних тридцати опросов:
// после разовой рассылки открытых опросов сразу сотня, и человек, чей опрос
// не попал в эту тридцатку, отвечал бы в пустоту — ровно та беда, которую
// мы только что чинили.
function waiting(app, field, value) {
  try {
    const orders = app.findRecordsByFilter("orders", `${field} = {:v}`, "-created", 20, 0, { v: String(value) });
    if (!orders.length) return null;
    const ids = orders.map((o) => `order = "${o.id}"`).join(" || ");
    const list = app.findRecordsByFilter("reviews", `(step = 'nps' || step = 'comment') && (${ids})`, "-created", 3, 0);
    return list.length ? list[0] : null;
  } catch (_) { return null; }
}

// Старые опросы с кнопками ещё висят у людей в переписке. Нажатие на такую
// кнопку засчитываем как оценку по десятибалльной шкале: 5 из 5 — это 10.
function answer(app, id, step, value) {
  let rec;
  try { rec = app.findRecordById("reviews", id); } catch (_) { return null; }
  if (+rec.get("nps") > 0) return rec;
  оценка(app, rec, Math.max(1, Math.min(5, +value || 0)) * 2);
  return rec;
}

// Разовая рассылка тем, кто заказывал раньше: опросы им уходили, но ответить
// было нельзя — нажатия глотал обработчик. Заказ мог быть давно, поэтому текст
// без «доставлен сегодня». По одному сообщению на собеседника, а не на заказ.
function blast(app, limit, dry) {
  const s = shop.settings(app);
  const out = { кому: 0, ушло: 0, ошибок: 0, пропущено: 0, примеры: [] };
  let orders = [];
  try {
    orders = app.findRecordsByFilter("orders",
      `status = "done" && (tg_chat != "" || max_chat != "")`, "-created", 500, 0);
  } catch (err) { out.ошибка = String(err); return out; }

  const виделиЧат = {};
  for (const o of orders) {
    const chat = String(o.get("tg_chat") || o.get("max_chat") || "");
    if (!chat || виделиЧат[chat]) { out.пропущено++; continue; }   // один человек — одно сообщение
    виделиЧат[chat] = true;

    let rec = null;
    try { rec = app.findFirstRecordByFilter("reviews", "order = {:o}", { o: o.id }); } catch (_) {}
    // уже ответил — не трогаем
    if (rec && (+rec.get("nps") > 0 || rec.get("comment"))) { out.пропущено++; continue; }
    if (out.кому >= (limit || 1000)) break;
    out.кому++;
    if (out.примеры.length < 5) out.примеры.push(o.get("number"));
    if (dry) continue;

    if (!rec) {
      rec = new Record(app.findCollectionByNameOrId("reviews"));
      rec.set("order", o.id);
      if (o.get("customer")) rec.set("customer", o.get("customer"));
      rec.set("via", o.get("tg_chat") ? "tg" : "max");
    }
    rec.set("step", "nps");
    app.save(rec);

    const text = `Здравствуйте! Вы заказывали у нас цветы — спасибо, что выбрали нас 🌸\n\n${ВОПРОС}`;
    try {
      if (rec.get("via") === "max") {
        require(`${__hooks}/lib/max.js`).send(s.get("max_token"), o.get("max_chat"), text);
        out.ушло++;
      } else {
        const r = shop.tg(shop.clientToken(s, shop.brandOfOrder(app, o)), "sendMessage", { chat_id: o.get("tg_chat"), text });
        if (r && r.ok) out.ушло++; else out.ошибок++;
      }
    } catch (_) { out.ошибок++; }
  }
  return out;
}

module.exports = { start, ask, reply, answer, comment, waiting, blast };
