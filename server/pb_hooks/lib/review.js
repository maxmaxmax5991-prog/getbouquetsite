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

// Ждём ли от этого покупателя ответ: цифру или свободный отзыв
function waiting(app, field, value) {
  try {
    const list = app.findRecordsByFilter("reviews", "step = 'nps' || step = 'comment'", "-created", 30, 0);
    for (const r of list) {
      const o = app.findRecordById("orders", r.get("order"));
      if (String(o.get(field) || "") === String(value)) return r;
    }
  } catch (_) {}
  return null;
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

module.exports = { start, ask, reply, answer, comment, waiting };
