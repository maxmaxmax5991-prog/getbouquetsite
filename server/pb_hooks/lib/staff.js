// Менеджеры: кто на линии, кому достался заказ, кто что правил.
//
// Всё, что меняет заказ руками человека, обязано пройти через `запись()` —
// иначе в ленте правок будет дырка, а она и нужна, чтобы понимать, с кого
// спрашивать. Поэтому правки заказа живут в серверных обработчиках, а не в
// браузере: из админки запись в базу напрямую обошла бы журнал.

const shop = require(`${__hooks}/lib/shop.js`);

// Сколько молчания считаем «ушёл». Две минуты: админка отмечается раз в 30
// секунд, и один пропущенный удар не должен гасить человека.
const ТИШИНА = 2 * 60 * 1000;

function нынешний(app, e) {
  try {
    const id = e.auth.id;
    return id ? app.findRecordById("managers", id) : null;
  } catch (_) { return null; }
}

// Запись в ленту. `manager` пустой — значит сделала система (автоназначение,
// оплата, МойСклад): так видно, где человек, а где машина.
function запись(app, order, manager, action, text) {
  try {
    const rec = new Record(app.findCollectionByNameOrId("order_log"));
    rec.set("order", order.id);
    rec.set("number", order.get("number"));
    rec.set("manager", manager ? manager.id : "");
    rec.set("nick", manager ? (manager.get("nick") || manager.get("name") || "") : "");
    rec.set("action", String(action || "").slice(0, 40));
    rec.set("text", String(text || "").slice(0, 2000));
    rec.set("at", new Date().toISOString());
    app.save(rec);
  } catch (err) { console.log("журнал заказа", err); }
}

function живые(app) {
  let все = [];
  try { все = app.findRecordsByFilter("managers", "off != true", "name", 100, 0); } catch (_) { return []; }
  const сейчас = Date.now();
  return все.map((m) => {
    const был = Date.parse(m.get("seen_at") || "") || 0;
    const вСети = сейчас - был < ТИШИНА;
    return {
      id: m.id,
      имя: m.get("name") || m.get("nick") || "",
      ник: m.get("nick") || "",
      роль: m.get("role") || "manager",
      чат: !!m.get("can_chat"),
      линия: m.get("line") || "",            // "on" | "busy" | ""
      вСети,
      был: m.get("seen_at") || "",
      активных: активных(app, m.id),
    };
  });
}

function активных(app, id) {
  try {
    return app.findRecordsByFilter("orders",
      `manager = {:m} && status != "done" && status != "cancelled"`, "", 500, 0, { m: id }).length;
  } catch (_) { return 0; }
}

// Кому отдать заказ. Наименее загруженному из тех, кто на линии: раздача по
// кругу исправно подкидывает заказы тому, кто уже завален десятком.
// Никого на линии — заказ остаётся ничьим и подсвечивается в списке.
function назначить(app, order) {
  if (order.get("manager")) return null;
  const на_линии = живые(app).filter((m) => m.линия === "on");
  if (!на_линии.length) return null;
  на_линии.sort((a, b) => (a.активных - b.активных) || a.имя.localeCompare(b.имя, "ru"));
  const кому = на_линии[0];
  try {
    // Пишем запросом, мимо хуков: соседнее сохранение заказа (оплата, МойСклад)
    // берёт копию, прочитанную раньше, и вернуло бы поле в пустоту.
    app.db().newQuery(`UPDATE orders SET manager = {:m}, manager_at = {:t}, manager_how = 'auto' WHERE id = {:id}`)
      .bind({ m: кому.id, t: new Date().toISOString(), id: order.id }).execute();
  } catch (err) { console.log("автоназначение", err); return null; }
  let rec = null;
  try { rec = app.findRecordById("managers", кому.id); } catch (_) {}
  запись(app, order, null, "назначен", `Автоматически: ${кому.имя}${кому.ник ? ` (${кому.ник})` : ""}, у него было ${кому.активных} активных`);
  return rec;
}

function отметиться(app, id) {
  try {
    app.db().newQuery("UPDATE managers SET seen_at = {:t} WHERE id = {:id}")
      .bind({ t: new Date().toISOString(), id }).execute();
  } catch (_) {}
}

// Кто чем распоряжается. Роли: owner — всё; sales — продажи целиком (заказы,
// забота, чат, сотрудники), но без прайсов, остатков, товаров и настроек;
// head — управляющий складом и ценами; manager — заказы и чат; care — забота.
const СОТРУДНИКИ = ["owner", "sales"];                       // заводить людей
const ЗАКАЗЫ = ["owner", "sales", "head", "manager"];        // видеть и править заказы

module.exports = { нынешний, запись, живые, активных, назначить, отметиться, ТИШИНА, СОТРУДНИКИ, ЗАКАЗЫ };
