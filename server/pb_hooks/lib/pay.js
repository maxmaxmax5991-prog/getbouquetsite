// Оплата картой через CloudPayments.
// Деньги списывает виджет на стороне CloudPayments; сервер сам проверяет платёж по их API
// (уведомления от них до нашего сервера не доходят — тот же обрыв связи, что и у Телеграма).
const shop = require(`${__hooks}/lib/shop.js`);

const API = "https://api.cloudpayments.ru";

// base64 для заголовка авторизации (в движке PocketBase нет встроенного)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(str) {
  let out = "", i = 0;
  const bytes = [];
  for (const ch of String(str)) {
    const c = ch.charCodeAt(0);
    if (c < 128) bytes.push(c);
    else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
    else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
  }
  while (i < bytes.length) {
    const a = bytes[i++], b = bytes[i++], c = bytes[i++];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)] +
      (b === undefined ? "=" : B64[((b & 15) << 2) | ((c || 0) >> 6)]) +
      (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}

function cp(s, path, body) {
  const id = s.get("cp_public_id"), secret = s.get("cp_secret");
  if (!id || !secret) return { ok: false, error: "Не указаны ключи CloudPayments." };
  try {
    const res = $http.send({
      url: API + path,
      method: "POST",
      body: JSON.stringify(body || {}),
      headers: {
        "content-type": "application/json",
        "Authorization": "Basic " + b64(`${id}:${secret}`),
      },
      timeout: 30,
    });
    if (res.statusCode === 401) return { ok: false, error: "Ключи CloudPayments не подошли: проверьте Public ID и пароль для API." };
    if (res.statusCode !== 200) return { ok: false, error: `CloudPayments ответил ошибкой ${res.statusCode}` };
    return { ok: true, data: res.json };
  } catch (err) {
    console.log("cloudpayments", path, err);
    return { ok: false, error: "Нет связи с CloudPayments." };
  }
}

// Проверка ключей — кнопка «Проверить оплату» в админке
function test(s) {
  const r = cp(s, "/test", {});
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.data || !r.data.Success) return { ok: false, error: (r.data && r.data.Message) || "Ключи не подошли." };
  return { ok: true };
}

// Сверяем платёж по номеру заказа и отмечаем оплату
function checkOrder(app, o) {
  if (o.get("payment_status") === "paid" || o.get("payment_method") !== "card") return false;
  const s = shop.settings(app);
  const r = cp(s, "/v2/payments/find", { InvoiceId: String(o.get("number")) });
  if (!r.ok || !r.data) return false;
  const m = r.data.Model;
  if (!r.data.Success || !m) return false;
  const okStatus = m.Status === "Completed" || m.Status === "Authorized";
  if (!okStatus) {
    if (m.Status === "Declined") { o.set("payment_status", "failed"); app.save(o); }
    return false;
  }
  if (Math.round(m.Amount) < Math.round(o.get("total"))) return false;   // оплачено меньше суммы заказа
  o.set("payment_status", "paid");
  o.set("payment_id", String(m.TransactionId || ""));
  o.set("paid_at", new Date().toISOString());
  if (o.get("status") === "new") o.set("status", "confirmed");
  app.save(o);
  const token = s.get("tg_token");
  shop.adminIds(s).forEach((chat) => shop.tg(token, "sendMessage", {
    chat_id: chat, text: `💳 Заказ №${o.get("number")} оплачен картой — ${shop.rub(o.get("total"))}`,
  }));
  try {
    const msl = require(`${__hooks}/lib/ms.js`);
    msl.markPaid(app, o);   // в МоёмСкладе статус станет «Принят, Оплачен»
  } catch (err) { console.log("ms markPaid", err); }
  return true;
}

module.exports = { cp, test, checkOrder };
