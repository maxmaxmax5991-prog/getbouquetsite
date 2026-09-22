// Общие функции магазина. Подключается через require() внутри обработчиков:
// обработчики PocketBase выполняются изолированно и не видят код верхнего уровня файлов.

const STATUS = {
  new: "Новый", confirmed: "Подтверждён", assembling: "Собирается", photo: "Фото отправлено",
  delivering: "В пути", done: "Доставлен", cancelled: "Отменён",
};

const rub = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";

function settings(app) {
  return app.findFirstRecordByFilter("settings", "id != ''");
}

function fileUrl(rec, name, thumb) {
  if (!name) return "";
  return `/api/files/${rec.collection().name}/${rec.id}/${name}` + (thumb ? `?thumb=${thumb}` : "");
}

// Кнопки размеров «по умолчанию» для букета с одной известной ценой.
// Если в названии есть число цветов — считаем от цены за стебель с небольшой скидкой за объём
// (у реальных прайсов стебель в 101 примерно на 25% дешевле, чем в 25); иначе — размеры S/M/L.
function estimateVariants(name, price, isStem) {
  const round = (x) => Math.max(10, Math.round(x / 100) * 100 - 10);
  if (isStem) return [5, 9, 15, 25, 51].map((n) => ({ label: String(n), price: price * n, estimated: false }));
  const m = String(name).match(/^(\d+)\s/);
  if (m) {
    const n = +m[1], per = price / n;
    let sizes = [9, 15, 25, 51, 101].filter((k) => k !== n && k >= n / 3 && k <= n * 2.2);
    sizes = sizes.concat([n]).sort((a, b) => a - b);
    while (sizes.length > 5) sizes.splice(sizes[0] === n ? sizes.length - 1 : 0, 1);
    return sizes.map((k) => k === n
      ? { label: String(k), price, estimated: false }
      : { label: String(k), price: round(per * k * Math.pow(k / n, -0.2)), estimated: true });
  }
  return [
    { label: "S", price: round(price * 0.75), estimated: true },
    { label: "M", price, estimated: false },
    { label: "L", price: round(price * 1.45), estimated: true },
  ];
}

function variantsOf(p) {
  const v = p.get("variants");
  const arr = Array.isArray(v) ? v : (v ? JSON.parse(JSON.stringify(v)) : []);
  return Array.isArray(arr) ? arr : [];
}

// ---------- Телеграм ----------
function tg(token, method, payload) {
  if (!token) return null;
  try {
    const res = $http.send({
      url: `https://api.telegram.org/bot${token}/${method}`,
      method: "POST",
      body: JSON.stringify(payload || {}),
      headers: { "content-type": "application/json" },
      timeout: 20,
    });
    if (res.statusCode !== 200) console.log("telegram", method, res.statusCode, toString(res.body));
    return res.json;
  } catch (err) {
    console.log("telegram error", method, err);
    return null;
  }
}

function adminIds(s) {
  return String(s.get("tg_admins") || "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
}

function orderText(o) {
  const items = (o.get("items") || []).map((it) => `• ${it.name}${it.label ? " · " + it.label : ""} × ${it.qty} — ${rub(it.sum)}`).join("\n");
  return [
    `🧾 Заказ №${o.get("number")} — ${STATUS[o.get("status")] || o.get("status")}`,
    "",
    items,
    `Доставка: ${rub(o.get("delivery_price") || 0)}`,
    `Итого: ${rub(o.get("total") || 0)}`,
    "",
    `📅 ${o.get("date")}, ${o.get("interval") || "—"}`,
    `📍 ${o.get("address")}`,
    `👤 ${o.get("name")}, ${o.get("phone")}`,
    o.get("recipient") ? `🎁 Получатель: ${o.get("recipient")}` : "",
    o.get("note") ? `💌 Открытка: ${o.get("note")}` : "",
  ].filter((x) => x !== "").join("\n");
}

function orderKeyboard(o) {
  const next = [["confirmed", "Подтвердить"], ["assembling", "Собирается"], ["photo", "Фото отправлено"],
    ["delivering", "В пути"], ["done", "Доставлен"], ["cancelled", "Отменить"]];
  const rows = [];
  for (let i = 0; i < next.length; i += 2) {
    rows.push(next.slice(i, i + 2).map(([s, t]) => ({ text: (o.get("status") === s ? "● " : "") + t, callback_data: `o:${o.id}:${s}` })));
  }
  return { inline_keyboard: rows };
}

function notifyOrder(app, o) {
  const s = settings(app);
  const token = s.get("tg_token");
  adminIds(s).forEach((chat) => tg(token, "sendMessage", { chat_id: chat, text: orderText(o), reply_markup: orderKeyboard(o) }));
}

module.exports = { STATUS, rub, settings, fileUrl, estimateVariants, variantsOf, tg, adminIds, orderText, orderKeyboard, notifyOrder };
