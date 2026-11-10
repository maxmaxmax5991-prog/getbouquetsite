// Онлайн-чек по 54-ФЗ. Пробиваем через кассу CloudPayments сразу после того,
// как подтвердилась оплата картой.
//
// Почему отдельным запросом, а не вместе с платежом: если в чеке окажется
// ошибка, платёж от этого не пострадает. Чек приложенный к оплате умеет
// завалить саму оплату, а это куда хуже, чем непробитый чек.
//
// Задним числом не бьём (решение владельца 10.11.2026) — только то, что
// оплачивается с этого момента.
const shop = require(`${__hooks}/lib/shop.js`);

function настройки(s) {
  return {
    on: !!s.get("kkt_on"),
    tax: Math.max(0, Math.min(5, +s.get("kkt_tax") || 0)),
    // пустая строка — «без НДС»; иначе ставка числом
    vat: String(s.get("kkt_vat") || "").trim() === "" ? null : +s.get("kkt_vat"),
    inn: String(s.get("org_inn") || "").replace(/\D/g, ""),
  };
}

// Позиции чека: товары заказа плюс доставка отдельной строкой-услугой.
// Сумма позиций обязана до копейки совпасть с суммой платежа, иначе касса
// чек отобьёт. Проверено на 561 позиции: цена × количество = сумма везде.
function позиции(o, vat) {
  const out = [];
  (shop.jget(o, "items") || []).forEach((it) => {
    const кол = +it.qty || 0, сумма = Math.round((+it.sum || 0) * 100) / 100;
    if (!кол || !(сумма > 0)) return;
    const имя = [it.name, it.label_text].filter(Boolean).join(" · ").slice(0, 128);
    out.push({
      label: имя || "Букет",
      price: Math.round((сумма / кол) * 100) / 100,
      quantity: кол, amount: сумма,
      vat, method: 4, object: 1,            // полный расчёт, товар
    });
  });
  const дост = Math.round((+o.get("delivery_price") || 0) * 100) / 100;
  if (дост > 0) {
    out.push({ label: "Доставка", price: дост, quantity: 1, amount: дост,
      vat, method: 4, object: 4 });        // полный расчёт, услуга
  }
  return out;
}

// Телефон для отправки чека. Почты в заказе нет, а по 54-ФЗ её и не нужно:
// чек можно направить на абонентский номер, который покупатель указал сам.
// Иностранные номера оставляем как есть: за месяц их 13 из 2 449, и все они
// длиннее российских — без этого чек по ним просто не уходил бы.
const телефон = (o) => {
  const ц = String(o.get("phone") || "").replace(/\D/g, "");
  if (ц.length === 11) return "+" + (ц[0] === "8" ? "7" + ц.slice(1) : ц);
  if (ц.length === 10) return "+7" + ц;
  if (ц.length >= 11 && ц.length <= 15) return "+" + ц;
  return "";
};

// Отметка «чек по этому заказу уже пробит» живёт в order_notified: ключ
// «заказ + вид», вторая вставка не проходит. Полем заказа держать нельзя —
// соседнее сохранение из старой копии вернёт его в пустоту (та же грабля,
// что с order_notified у статусов).
function ужеБили(app, id) {
  try {
    app.db().newQuery("INSERT INTO order_notified (order_id, status, at) VALUES ({:id}, 'receipt', {:t})")
      .bind({ id, t: new Date().toISOString() }).execute();
    return false;
  } catch (_) { return true; }
}

const снять = (app, id) => {
  try { app.db().newQuery("DELETE FROM order_notified WHERE order_id = {:id} AND status = 'receipt'").bind({ id }).execute(); } catch (_) {}
};

function пробить(app, s, o, brand) {
  const н = настройки(s);
  if (!н.on) return { ok: false, выкл: true };
  if (!н.inn) return { ok: false, error: "В настройках не указан ИНН — чек пробить нечем." };
  const тел = телефон(o);
  if (!тел) return { ok: false, error: "У заказа нет телефона — чек отправить некуда." };
  const items = позиции(o, н.vat);
  const сумма = Math.round(items.reduce((n, x) => n + x.amount, 0) * 100) / 100;
  const итого = Math.round((+o.get("total") || 0) * 100) / 100;
  // Расхождение в копейку касса не простит, а молча пробить не ту сумму хуже,
  // чем не пробить вовсе: это уже неверный фискальный документ.
  if (!items.length || Math.abs(сумма - итого) > 0.009) {
    return { ok: false, error: `Чек не сходится с оплатой: позиции ${сумма} ₽, оплачено ${итого} ₽.` };
  }
  if (ужеБили(app, o.id)) return { ok: false, повтор: true };

  const r = require(`${__hooks}/lib/pay.js`).cp(s, "/kkt/receipt", {
    Inn: +н.inn, Type: "Income",
    InvoiceId: shop.invoiceOf(o), AccountId: тел,
    CustomerReceipt: {
      Items: items, taxationSystem: н.tax, phone: тел, email: "",
      amounts: { electronic: итого },
    },
  }, brand);
  if (!r.ok || !r.data || r.data.Success === false) {
    // Отметку снимаем: беда могла быть разовой, и чек надо будет добить.
    снять(app, o.id);
    const текст = (r.data && r.data.Message) || r.error || "касса не ответила";
    return { ok: false, error: String(текст) };
  }
  // Номер чека в кассе: по InvoiceId чек потом не находится (проверено), а по
  // этому Id состояние чека можно спросить в любой момент.
  const id = String((r.data.Model && r.data.Model.Id) || "");
  try {
    app.db().newQuery("UPDATE orders SET receipt_at = {:t} WHERE id = {:id}")
      .bind({ t: new Date().toISOString() + (id ? " " + id : ""), id: o.id }).execute();
  } catch (_) {}
  return { ok: true, позиций: items.length, сумма: итого, id };
}

// Чек на доплату. Состава у доплаты нет — только сумма, — поэтому в чеке она
// идёт одной строкой-услугой «Доплата по заказу №N». Касса требует позицию,
// придумывать за менеджера состав мы не вправе.
function доплата(app, s, o, ex, brand) {
  const н = настройки(s);
  if (!н.on) return { ok: false, выкл: true };
  const тел = телефон(o);
  const сумма = Math.round((+ex.get("sum") || 0) * 100) / 100;
  if (!н.inn || !тел || !(сумма > 0)) return { ok: false, error: "Нет ИНН, телефона или суммы." };
  const ключ = "receipt-ex-" + ex.id;
  if (ужеБили(app, ключ)) return { ok: false, повтор: true };
  const r = require(`${__hooks}/lib/pay.js`).cp(s, "/kkt/receipt", {
    Inn: +н.inn, Type: "Income",
    InvoiceId: String(ex.get("invoice") || ""), AccountId: тел,
    CustomerReceipt: {
      Items: [{ label: `Доплата по заказу №${o.get("number")}`, price: сумма, quantity: 1,
        amount: сумма, vat: н.vat, method: 4, object: 4 }],
      taxationSystem: н.tax, phone: тел, email: "",
      amounts: { electronic: сумма },
    },
  }, brand);
  if (!r.ok || !r.data || r.data.Success === false) {
    снять(app, ключ);
    return { ok: false, error: String((r.data && r.data.Message) || r.error || "касса не ответила") };
  }
  return { ok: true, сумма };
}

// Чек возврата. Бьём только когда деньги ДЕЙСТВИТЕЛЬНО вернули: фискальный
// возврат по деньгам, оставшимся у нас, — враньё в отчётности. Поэтому вызов
// идёт не из отмены заказа, а из ответа «вернули» (кнопка в боте).
function возврат(app, s, o, brand) {
  const н = настройки(s);
  if (!н.on) return { ok: false, выкл: true };
  const тел = телефон(o);
  if (!н.inn || !тел) return { ok: false, error: "Нет ИНН или телефона." };
  const items = позиции(o, н.vat);
  const сумма = Math.round(items.reduce((n, x) => n + x.amount, 0) * 100) / 100;
  const итого = Math.round((+o.get("total") || 0) * 100) / 100;
  if (!items.length || Math.abs(сумма - итого) > 0.009) {
    return { ok: false, error: `Возврат не сходится: позиции ${сумма} ₽, оплачено ${итого} ₽.` };
  }
  const ключ = "receipt-back-" + o.id;
  if (ужеБили(app, ключ)) return { ok: false, повтор: true };
  const r = require(`${__hooks}/lib/pay.js`).cp(s, "/kkt/receipt", {
    Inn: +н.inn, Type: "IncomeReturn",
    InvoiceId: shop.invoiceOf(o), AccountId: тел,
    CustomerReceipt: { Items: items, taxationSystem: н.tax, phone: тел, email: "",
      amounts: { electronic: итого } },
  }, brand);
  if (!r.ok || !r.data || r.data.Success === false) {
    снять(app, ключ);
    return { ok: false, error: String((r.data && r.data.Message) || r.error || "касса не ответила") };
  }
  return { ok: true, сумма: итого };
}

module.exports = { пробить, доплата, возврат, позиции, настройки };
