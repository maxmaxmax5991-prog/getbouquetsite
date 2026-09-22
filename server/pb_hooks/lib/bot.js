// Телеграм-бот магазина: добавление товаров фотографией, включение/выключение, заказы.
const shop = require(`${__hooks}/lib/shop.js`);

const MENU = { keyboard: [[{ text: "Товары" }, { text: "Заказы" }], [{ text: "Добавить товар" }, { text: "Помощь" }]], resize_keyboard: true };
const PAGE = 8;

const HELP = [
  "Как добавить товар:",
  "отправьте фото букета и в подписи к фото напишите 2–3 строки:",
  "",
  "1) Название",
  "2) Цена или размеры",
  "3) Раздел (можно не писать — будет первый раздел)",
  "",
  "Пример — букет с размерами:",
  "Розы Кения красные",
  "25=2190, 51=3890, 101=6590",
  "Кенийские розы",
  "",
  "Пример — сорт одноголовых роз (цена по прайсу длина × количество):",
  "Маритим",
  "50, 60 см",
  "Одноголовые розы",
  "",
  "Пример — одна цена (размеры посчитаются сами, их можно поправить в админке):",
  "Гортензия белая",
  "4990",
  "",
  "«Товары» — список с кнопками: ✅ на сайте, ⛔️ скрыт. Нажмите на товар, чтобы скрыть или показать.",
  "Чтобы найти товар, просто напишите часть названия.",
  "«Заказы» — активные заказы; статус меняется кнопками под заказом.",
].join("\n");

function listKeyboard(app, s, filter, params, page, query) {
  const all = app.findRecordsByFilter("products", filter, "sort,-created", 200, 0, params);
  const slice = all.slice(page * PAGE, page * PAGE + PAGE);
  const rows = slice.map((p) => {
    const v = shop.variantsOf(p, s);
    const price = v.length ? Math.min.apply(null, v.map((x) => x.price)) : p.get("price");
    return [{ text: `${p.get("active") ? "✅" : "⛔️"} ${p.get("name")} · ${v.length ? "от " : ""}${shop.rub(price)}`.slice(0, 60), callback_data: `t:${p.id}` }];
  });
  const nav = [];
  if (!query) {
    if (page > 0) nav.push({ text: "‹ Назад", callback_data: `p:${page - 1}` });
    if ((page + 1) * PAGE < all.length) nav.push({ text: "Дальше ›", callback_data: `p:${page + 1}` });
  }
  if (nav.length) rows.push(nav);
  return { total: all.length, markup: { inline_keyboard: rows } };
}

function sendList(app, s, chat, page, query, editMsg) {
  const token = s.get("tg_token");
  const filter = query ? "name ~ {:q}" : "id != ''";
  const { total, markup } = listKeyboard(app, s, filter, query ? { q: query } : {}, page, query);
  const text = query
    ? (total ? `Нашлось: ${total}${total > PAGE ? ` (показаны первые ${PAGE})` : ""}. Нажмите, чтобы скрыть или показать на сайте.` : `Ничего не нашлось по запросу «${query}».`)
    : `Товары (${total}). Нажмите, чтобы скрыть или показать на сайте.`;
  if (editMsg) shop.tg(token, "editMessageText", { chat_id: chat, message_id: editMsg, text, reply_markup: markup });
  else shop.tg(token, "sendMessage", { chat_id: chat, text, reply_markup: markup });
}

function parseCaption(app, caption) {
  const lines = String(caption || "").split("\n").map((x) => x.trim()).filter(Boolean);
  if (!lines.length) return { error: "Добавьте подпись к фото: название и цену. Напишите «Помощь», чтобы увидеть пример." };
  const name = lines[0].slice(0, 120);
  const priceLine = lines[1] || "";
  const catLine = (lines[2] || "").toLowerCase();
  const cats = app.findRecordsByFilter("categories", "id != ''", "sort", 100, 0);
  let cat = cats.find((c) => !c.get("addon"));
  if (catLine) {
    const found = cats.find((c) => c.get("name").toLowerCase() === catLine || c.get("slug") === catLine) ||
                  cats.find((c) => c.get("name").toLowerCase().indexOf(catLine) >= 0 || catLine.indexOf(c.get("name").toLowerCase()) >= 0);
    if (!found) return { error: `Не нашёл раздел «${lines[2]}». Разделы: ${cats.map((c) => c.get("name")).join(", ")}.` };
    cat = found;
  }
  const out = { name, category: cat.id, addon: cat.get("addon"), lengths: null, variants: null, price: 0 };
  if (/см/i.test(priceLine)) {
    out.lengths = (priceLine.match(/\d+/g) || []).map(Number).filter((n) => [40, 50, 60, 70, 80].indexOf(n) >= 0);
    if (!out.lengths.length) return { error: "Не понял длины. Пример: 50, 60 см" };
  } else if (priceLine.indexOf("=") >= 0) {
    out.variants = priceLine.split(/[,;]/).map((part) => {
      const [l, p] = part.split("=").map((x) => x.trim());
      return { label: l, price: +String(p || "").replace(/\D/g, "") };
    }).filter((v) => v.label && v.price > 0);
    if (!out.variants.length) return { error: "Не понял размеры. Пример: 25=2190, 51=3890, 101=6590" };
    out.price = Math.min.apply(null, out.variants.map((v) => v.price));
  } else {
    out.price = +priceLine.replace(/\D/g, "");
    if (!(out.price > 0)) return { error: "Во второй строке подписи укажите цену, например: 4990" };
    if (!out.addon) out.variants = shop.estimateVariants(name, out.price);
  }
  return out;
}

function addProduct(app, s, chat, msg) {
  const token = s.get("tg_token");
  const parsed = parseCaption(app, msg.caption);
  if (parsed.error) return shop.tg(token, "sendMessage", { chat_id: chat, text: parsed.error });

  const photo = msg.photo[msg.photo.length - 1];
  const info = shop.tg(token, "getFile", { file_id: photo.file_id });
  if (!info || !info.ok) return shop.tg(token, "sendMessage", { chat_id: chat, text: "Не получилось скачать фото. Попробуйте ещё раз." });
  const file = $filesystem.fileFromURL(`https://api.telegram.org/file/bot${token}/${info.result.file_path}`, 60);
  file.name = "photo.jpg";

  const col = app.findCollectionByNameOrId("products");
  const p = new Record(col);
  p.set("name", parsed.name);
  p.set("category", parsed.category);
  p.set("price", parsed.price || 0);
  p.set("photo", [file]);
  if (parsed.lengths) p.set("lengths", parsed.lengths);
  if (parsed.variants) p.set("variants", parsed.variants);
  p.set("active", true);
  p.set("sort", 0);
  app.save(p);

  const v = shop.variantsOf(p, s);
  const priceText = v.length ? v.map((x) => `${x.label}: ${shop.rub(x.price)}${x.estimated ? " (расчётная)" : ""}`).join("\n") : shop.rub(p.get("price"));
  const url = String(s.get("site_url") || "").replace(/\/$/, "");
  shop.tg(token, "sendMessage", {
    chat_id: chat,
    text: `Добавлено на сайт: ${p.get("name")}\n\n${priceText}${url ? `\n\n${url}/#/p/${p.id}` : ""}`,
    reply_markup: { inline_keyboard: [[{ text: "⛔️ Скрыть с сайта", callback_data: `t:${p.id}` }]] },
  });
}

function handle(app, secret, upd) {
  const s = shop.settings(app);
  if (!s.get("tg_secret") || secret !== s.get("tg_secret")) return;
  const token = s.get("tg_token");
  const admins = shop.adminIds(s);

  if (upd.callback_query) {
    const cb = upd.callback_query, chat = cb.message.chat.id;
    if (admins.indexOf(String(cb.from.id)) < 0) return shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: "Нет доступа" });
    const [kind, a, b] = String(cb.data).split(":");
    if (kind === "t") {
      const p = app.findRecordById("products", a);
      p.set("active", !p.get("active"));
      app.save(p);
      const kb = cb.message.reply_markup || { inline_keyboard: [] };
      kb.inline_keyboard.forEach((row) => row.forEach((btn) => {
        if (btn.callback_data === `t:${p.id}`) {
          btn.text = btn.text.indexOf("Скрыть с сайта") >= 0 || btn.text.indexOf("Показать на сайте") >= 0
            ? (p.get("active") ? "⛔️ Скрыть с сайта" : "✅ Показать на сайте")
            : btn.text.replace(/^(✅|⛔️)/, p.get("active") ? "✅" : "⛔️");
        }
      }));
      shop.tg(token, "editMessageReplyMarkup", { chat_id: chat, message_id: cb.message.message_id, reply_markup: kb });
      shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: p.get("active") ? "Показан на сайте" : "Скрыт с сайта" });
    } else if (kind === "p") {
      sendList(app, s, chat, +a || 0, "", cb.message.message_id);
      shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id });
    } else if (kind === "o") {
      const o = app.findRecordById("orders", a);
      o.set("status", b);
      app.save(o);
      shop.tg(token, "editMessageText", { chat_id: chat, message_id: cb.message.message_id, text: shop.orderText(o), reply_markup: shop.orderKeyboard(o) });
      shop.tg(token, "answerCallbackQuery", { callback_query_id: cb.id, text: shop.STATUS[b] });
    }
    return;
  }

  const msg = upd.message;
  if (!msg) return;
  const chat = msg.chat.id, text = String(msg.text || "").trim();
  if (admins.indexOf(String(msg.from.id)) < 0) {
    if (text.indexOf("/start") === 0) {
      shop.tg(token, "sendMessage", { chat_id: chat, text: `Здравствуйте! Ваш номер в Телеграме: ${msg.from.id}\n\nЧтобы управлять магазином, добавьте этот номер в админке: Настройки → Телеграм → «Кто может управлять ботом».` });
    }
    return;
  }

  if (msg.photo && msg.photo.length) return addProduct(app, s, chat, msg);
  if (text === "/start" || text === "Меню") return shop.tg(token, "sendMessage", { chat_id: chat, text: "Готово! Меню внизу. Чтобы добавить товар, пришлите фото с подписью.", reply_markup: MENU });
  if (text === "Помощь" || text === "/help" || text === "Добавить товар") return shop.tg(token, "sendMessage", { chat_id: chat, text: HELP, reply_markup: MENU });
  if (text === "Товары" || text === "/products") return sendList(app, s, chat, 0, "");
  if (text === "Заказы" || text === "/orders") {
    const orders = app.findRecordsByFilter("orders", "status != 'done' && status != 'cancelled'", "-created", 10, 0);
    if (!orders.length) return shop.tg(token, "sendMessage", { chat_id: chat, text: "Активных заказов нет." });
    orders.reverse().forEach((o) => shop.tg(token, "sendMessage", { chat_id: chat, text: shop.orderText(o), reply_markup: shop.orderKeyboard(o) }));
    return;
  }
  if (text && text[0] !== "/") return sendList(app, s, chat, 0, text.slice(0, 60));
}

function setup(app, s) {
  const token = s.get("tg_token"), url = String(s.get("site_url") || "").replace(/\/$/, "");
  if (!token || !url || !s.get("tg_secret")) return { ok: false, error: "Укажите ключ бота и адрес сайта." };
  const hook = shop.tg(token, "setWebhook", { url: `${url}/api/tg/${s.get("tg_secret")}`, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  shop.tg(token, "setMyCommands", { commands: [
    { command: "start", description: "Меню" }, { command: "products", description: "Товары" },
    { command: "orders", description: "Заказы" }, { command: "help", description: "Как добавить товар" }] });
  return hook || { ok: false, error: "Телеграм не ответил. Проверьте ключ бота." };
}

module.exports = { handle, setup };
