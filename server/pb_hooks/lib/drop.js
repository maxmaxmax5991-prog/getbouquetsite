// Дроп дня: мало букетов, старт в 12:00, очередь и 15 минут на оплату.
//
// Главное правило: букет считается занятым с того мига, как человека позвали,
// и освобождается, если он не оплатил за 15 минут. Иначе одну и ту же сотню
// роз пообещали бы двоим — а это хуже, чем «не досталось».
const shop = require(`${__hooks}/lib/shop.js`);

const ОКНО = 15;                 // минут на оплату
const СУТКИ = 24 * 3600 * 1000;  // один букет в руки за это время

// Москва = UTC+3. Сервер живёт по Гринвичу, а владелец пишет часы московские.
function мск(сдвиг) {
  const d = new Date(Date.now() + 3 * 3600 * 1000 + (сдвиг || 0));
  const s = d.toISOString();
  return { день: s.slice(0, 10), время: s.slice(11, 16), полное: s.slice(0, 10) + " " + s.slice(11, 16), мс: Date.now() };
}
const вМс = (строка) => {
  const t = String(строка || "").trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return 0;
  return Date.parse(t.replace(" ", "T") + ":00Z") - 3 * 3600 * 1000;   // из московского в настоящее
};

// Дроп, который сейчас показываем: сегодняшний, а если его нет — ближайший
function текущий(app) {
  const сег = мск().день;
  try {
    return app.findFirstRecordByFilter("drops", "active = true && date >= {:d}", { d: сег });
  } catch (_) { return null; }
}

const лоты = (d) => (shop.jget(d, "lots") || []).filter((l) => l && l.product);
const свободно = (d) => лоты(d).reduce((n, l) => n + Math.max(0, +l.left || 0), 0);
const всего = (d) => лоты(d).reduce((n, l) => n + Math.max(0, +l.qty || 0), 0);

function состояние(d) {
  if (!d) return "none";
  const старт = вМс(d.get("start_at"));
  if (!старт || Date.now() < старт) return "soon";
  return свободно(d) > 0 ? "live" : "over";
}

// Очередь дропа по порядку занятия места
function очередь(app, drop, статус) {
  try {
    return app.findRecordsByFilter("drop_queue",
      статус ? "drop = {:d} && status = {:s}" : "drop = {:d}",
      "place", 500, 0, { d: drop.id, s: статус || "" });
  } catch (_) { return []; }
}

// Брал ли человек букет за последние сутки — один в руки
function ужеБрал(app, customer, phone) {
  const порог = new Date(Date.now() - СУТКИ).toISOString().replace("T", " ").slice(0, 19);
  const хвост = String(phone || "").replace(/\D/g, "").slice(-10);
  try {
    const по = app.findRecordsByFilter("drop_queue",
      `status = "paid" && updated > {:t} && (customer = {:c}${хвост.length === 10 ? " || phone ~ {:p}" : ""})`,
      "-updated", 1, 0, { t: порог, c: String(customer || "-"), p: хвост });
    return !!по.length;
  } catch (_) { return false; }
}

// Записать человека в очередь. Возвращает его запись.
function встать(app, drop, cust) {
  let есть = null;
  try { есть = app.findFirstRecordByFilter("drop_queue", "drop = {:d} && customer = {:c}", { d: drop.id, c: cust.id }); } catch (_) {}
  if (есть) return есть;
  const место = очередь(app, drop).length + 1;
  const r = new Record(app.findCollectionByNameOrId("drop_queue"));
  r.set("drop", drop.id); r.set("customer", cust.id);
  r.set("chat", cust.get("tg_chat") || "");
  r.set("name", cust.get("name") || "");
  r.set("phone", cust.get("phone_ok") || cust.get("phone") || "");
  r.set("place", место); r.set("status", "waiting");
  app.save(r);
  return r;
}

// Сорт, которого осталось больше всего: раздаём равномерно, чтобы под конец
// не остался один непопулярный сорт на всех.
function щедрыйЛот(d) {
  const сп = лоты(d).filter((l) => +l.left > 0).sort((a, b) => (+b.left) - (+a.left));
  return сп[0] || null;
}
function занятьЛот(app, d, pid) {
  const сп = лоты(d);
  const i = сп.findIndex((l) => String(l.product) === String(pid));
  if (i < 0 || +сп[i].left <= 0) return false;
  сп[i].left = +сп[i].left - 1;
  сохранитьЛоты(app, d, сп);
  return true;
}
function вернутьЛот(app, d, pid) {
  const сп = лоты(d);
  const i = сп.findIndex((l) => String(l.product) === String(pid));
  if (i < 0) return;
  сп[i].left = Math.min(+сп[i].qty || 0, (+сп[i].left || 0) + 1);
  сохранитьЛоты(app, d, сп);
}
// Пишем запросом, мимо хуков: соседнее сохранение дропа из старой копии
// вернуло бы остаток обратно — той же граблёй мы уже ловились с ms_id.
function сохранитьЛоты(app, d, сп) {
  try {
    app.db().newQuery("UPDATE drops SET lots = {:v} WHERE id = {:id}")
      .bind({ v: JSON.stringify(сп), id: d.id }).execute();
    d.set("lots", сп);
  } catch (err) { console.log("дроп: лоты", err); }
}

// Выдать букет тому, кого позвали. Проверяем всё заново: приглашение живое,
// срок не вышел, сорт ещё остался. Браузеру верить нельзя — он мог пролежать
// в кармане полчаса и прислать свою картину мира.
function взять(app, cust, pid, phone) {
  const беда = (m) => { throw new BadRequestError(m); };
  const d = текущий(app);
  if (!d) беда("Дроп уже закончился.");
  if (Date.now() < вМс(d.get("start_at"))) беда("Дроп ещё не начался.");
  let q = null;
  if (cust) {
    try { q = app.findFirstRecordByFilter("drop_queue", "drop = {:d} && customer = {:c}", { d: d.id, c: String(cust) }); } catch (_) {}
  }
  // Запасной путь — по телефону. 26.10 людей позвали в бот, они пришли по
  // ссылке с телефона, где сайт их не знал, и получали «вас нет в очереди»:
  // заказ уходил без привязки к карточке покупателя. Телефон в заказе есть
  // всегда, и в очереди он тоже записан.
  if (!q) {
    const хвост = String(phone || "").replace(/\D/g, "").slice(-10);
    if (хвост.length === 10) {
      try {
        q = app.findRecordsByFilter("drop_queue", "drop = {:d}", "-updated", 200, 0, { d: d.id })
          .find((x) => String(x.get("phone") || "").replace(/\D/g, "").slice(-10) === хвост) || null;
      } catch (_) {}
    }
  }
  if (!q) беда("Вас нет в очереди на этот дроп.");
  if (q.get("status") === "paid") беда("Вы уже забрали букет в этом дропе.");
  if (q.get("status") !== "invited") беда("Ваша очередь ещё не подошла.");
  const до = Date.parse(String(q.get("expires_at") || "").replace(" ", "T"));
  if (!до || Date.now() > до) беда("Пятнадцать минут вышли — букет ушёл следующему.");
  // Сорт человек выбирает сам, уже видя витрину: при приглашении мы держим
  // место, а не конкретный сорт.
  const сп = лоты(d);
  const i = сп.findIndex((l) => String(l.product) === String(pid));
  if (i < 0) беда("Этого сорта в дропе нет.");
  if (+сп[i].left <= 0) беда("Этот сорт только что разобрали — выберите другой.");
  // Букет списываем НЕ здесь. Проверка идёт в середине сборки заказа, и дальше
  // он ещё может не пройти по дате или адресу — тогда букет исчез бы в никуда,
  // не достав никому. Списываем после того, как заказ сохранился.
  return { drop: d, очередь: q, len: +d.get("len") || 40, cnt: +d.get("cnt") || 101, price: +d.get("price") || 0,
    ready_at: d.get("ready_at") || "" };
}
// Отметка «забрал» ставится запросом: соседнее сохранение заказа не должно
// вернуть её обратно в «позвали» (той же граблёй мы ловились с ms_id).
function отметитьВзятие(app, q, orderId, pid) {
  // Сначала снимаем букет с остатка дропа — теперь заказ точно состоялся
  try {
    const d = текущий(app);
    if (d && pid) {
      const сп = лоты(d);
      const i = сп.findIndex((l) => String(l.product) === String(pid));
      if (i >= 0 && +сп[i].left > 0) { сп[i].left = +сп[i].left - 1; сохранитьЛоты(app, d, сп); }
    }
  } catch (err) { console.log("дроп: списание букета", err); }
  try {
    app.db().newQuery("UPDATE drop_queue SET status = 'paid', \"order\" = {:o} WHERE id = {:id}")
      .bind({ o: String(orderId || ""), id: q.id }).execute();
  } catch (err) { console.log("дроп: отметка взятия", err); }
}

module.exports = { ОКНО, взять, отметитьВзятие, мск, вМс, текущий, лоты, свободно, всего, состояние, очередь, ужеБрал, встать, щедрыйЛот, занятьЛот, вернутьЛот };
