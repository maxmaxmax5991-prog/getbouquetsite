// Оценка после вручения: три вопроса по пятибалльной шкале и свободный отзыв.
// Спрашиваем по одному — так отвечают почти все, а стена кнопок отпугивает.
const shop = require(`${__hooks}/lib/shop.js`);

const QUESTIONS = {
  order: "1 из 3. Удобно было оформить заказ на сайте?",
  bouquet: "2 из 3. Как вам сам букет?",
  delivery: "3 из 3. Как прошла доставка?",
};
// Пять одинаковых звёздочек с телефона не различить — ставим цифры и подписываем края
const LABEL = { 1: "1 · плохо", 2: "2", 3: "3", 4: "4", 5: "5 · отлично" };
const NEXT = { order: "bouquet", bouquet: "delivery", delivery: "comment" };
const FIELD = { order: "q_order", bouquet: "q_bouquet", delivery: "q_delivery" };

function stars(id, step) {
  const row = [1, 2, 3, 4, 5].map((n) => ({ text: LABEL[n], callback_data: `rv:${id}:${step}:${n}` }));
  return [row.slice(0, 3), row.slice(3)];
}

// Отправить очередной вопрос туда, где покупатель с нами общается
function ask(app, rec) {
  const step = String(rec.get("step") || "order");
  const s = shop.settings(app);
  let o = null;
  try { o = app.findRecordById("orders", rec.get("order")); } catch (_) { return; }
  const via = rec.get("via");
  const head = step === "order"
    ? `Заказ №${o.get("number")} доставлен 🌸\n\nПомогите нам стать лучше — три вопроса, по одному нажатию.\n\n`
    : "";

  if (step === "comment") {
    // Развилка: недовольного берёт менеджер, довольного зовём оставить отзыв.
    const marks = [rec.get("q_order"), rec.get("q_bouquet"), rec.get("q_delivery")].map((x) => +x || 0);
    const low = Math.min.apply(null, marks);
    const url = String(s.get("review_url") || "").trim();

    if (low <= 3) {
      rec.set("needs_call", true);
      app.save(rec);
      const text = "Спасибо за честность. Жаль, что не всё получилось — мы свяжемся с вами и разберёмся.";
      if (via === "max") require(`${__hooks}/lib/max.js`).send(s.get("max_token"), o.get("max_chat"), text);
      else shop.tg(shop.clientToken(s), "sendMessage", { chat_id: o.get("tg_chat"), text });
      shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
        text: `🔴 Недовольный клиент — заказ №${o.get("number")}\nОформление ${marks[0]}, букет ${marks[1]}, доставка ${marks[2]}\n${o.get("name")}, ${o.get("phone")}\n\nНужно позвонить.`,
        reply_markup: { inline_keyboard: [[{ text: "✅ Взял в работу", callback_data: `rh:${rec.id}` }]] } }));
      return;
    }

    if (marks.every((m) => m === 5) && url) {
      const text = "Спасибо! Пятёрки — лучшее, что может случиться с цветочным.\n\nЕсли не сложно, оставьте пару слов на Яндекс.Картах — это очень помогает маленькому магазину.";
      if (via === "max") {
        const mx = require(`${__hooks}/lib/max.js`);
        mx.send(s.get("max_token"), o.get("max_chat"), text, [[mx.btnLink("Оставить отзыв", url)]]);
      } else {
        shop.tg(shop.clientToken(s), "sendMessage", { chat_id: o.get("tg_chat"), text,
          reply_markup: { inline_keyboard: [[{ text: "⭐ Оставить отзыв на Яндекс.Картах", url }]] } });
      }
      rec.set("step", "done");
      app.save(rec);
      return;
    }

    const text = "Спасибо! Если хотите что-то добавить — напишите одним сообщением. Если нет, просто не отвечайте.";
    if (via === "max") require(`${__hooks}/lib/max.js`).send(s.get("max_token"), o.get("max_chat"), text);
    else shop.tg(shop.clientToken(s), "sendMessage", { chat_id: o.get("tg_chat"), text });
    return;
  }
  const text = head + QUESTIONS[step];
  if (via === "max") {
    const mx = require(`${__hooks}/lib/max.js`);
    const rows = [1, 2, 3, 4, 5].map((n) => mx.btn(LABEL[n], `rv:${rec.id}:${step}:${n}`));
    mx.send(s.get("max_token"), o.get("max_chat"), text, [rows.slice(0, 3), rows.slice(3)]);
  } else {
    shop.tg(shop.clientToken(s), "sendMessage", { chat_id: o.get("tg_chat"), text,
      reply_markup: { inline_keyboard: stars(rec.id, step) } });
  }
}

// Завести опрос после вручения — один раз на заказ
function start(app, o) {
  if (!o.get("tg_chat") && !o.get("max_chat")) return;
  try { app.findFirstRecordByFilter("reviews", "order = {:o}", { o: o.id }); return; } catch (_) {}
  const rec = new Record(app.findCollectionByNameOrId("reviews"));
  rec.set("order", o.id);
  if (o.get("customer")) rec.set("customer", o.get("customer"));
  rec.set("step", "order");
  rec.set("via", o.get("tg_chat") ? "tg" : "max");
  app.save(rec);
  ask(app, rec);
}

// Ответ на вопрос: сохранить и спросить следующее
function answer(app, id, step, value) {
  let rec;
  try { rec = app.findRecordById("reviews", id); } catch (_) { return null; }
  if (!FIELD[step]) return rec;
  rec.set(FIELD[step], Math.max(1, Math.min(5, +value || 0)));
  rec.set("step", NEXT[step] || "done");
  app.save(rec);
  ask(app, rec);

  return rec;
}

// Свободный отзыв, если покупатель решил написать
function comment(app, rec, text) {
  rec.set("comment", String(text).slice(0, 1000));
  rec.set("step", "done");
  app.save(rec);
  try {
    const s = shop.settings(app);
    const o = app.findRecordById("orders", rec.get("order"));
    shop.adminIds(s).forEach((chat) => shop.tg(s.get("tg_token"), "sendMessage", { chat_id: chat,
      text: `💬 Отзыв по заказу №${o.get("number")}: «${String(text).slice(0, 500)}»` }));
  } catch (_) {}
}

// Ждём ли от этого покупателя свободный отзыв
function waiting(app, field, value) {
  try {
    const list = app.findRecordsByFilter("reviews", "step = 'comment'", "-created", 20, 0);
    for (const r of list) {
      const o = app.findRecordById("orders", r.get("order"));
      if (String(o.get(field) || "") === String(value)) return r;
    }
  } catch (_) {}
  return null;
}

module.exports = { start, answer, comment, waiting, ask };
