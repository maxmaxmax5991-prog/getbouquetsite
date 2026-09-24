/// <reference path="../pb_data/types.d.ts" />
// Статусы из МоегоСклада на сайт: раз в минуту читаем активные заказы и обновляем их у нас.
// Клиенту при этом уходит сообщение в бот (если он подписан).

cronAdd("ms-status", "* * * * *", () => {
  const shop = require(`${__hooks}/lib/shop.js`);
  const msl = require(`${__hooks}/lib/ms.js`);
  // соответствие статусов (внутри задания: обработчики PocketBase не видят код верхнего уровня)
  const MAP = [
    [/отмен/i, "cancelled"],
    [/самовывоз завершен|завершен|доставлен|выполнен/i, "done"],
    [/доставля|в пути|передан службе доставки|курьер/i, "delivering"],
    [/готов к самовывозу|собран/i, "photo"],
    [/сборка|ожидает сборку|комплектовать/i, "assembling"],
    [/принят, оплачен|подтвержден/i, "confirmed"],
  ];
  const s = shop.settings($app);
  if (!s.get("ms_enabled") || !s.get("ms_token")) return;

  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
  const list = $app.findRecordsByFilter(
    "orders",
    `ms_id != "" && status != "done" && status != "cancelled" && created > {:since}`,
    "-created", 50, 0, { since });
  if (!list.length) return;

  list.forEach((o) => {
    try {
      const r = msl.ms(s, "GET", `/entity/customerorder/${o.get("ms_id")}?expand=state`);
      if (!r.ok || !r.data) return;
      const name = (r.data.state && r.data.state.name) || "";
      if (!name) return;
      const hit = MAP.find(([re]) => re.test(name));
      if (!hit) return;
      const next = hit[1];
      if (next === o.get("status")) return;
      o.set("status", next);
      // курьера, если менеджер заполнил поле в МоёмСкладе, добавим в сообщение клиенту
      const attrs = r.data.attributes || [];
      const courier = attrs.find((a) => String(a.name || "").toLowerCase().indexOf("курьер") >= 0);
      if (courier && courier.value) o.set("comment", String(courier.value).slice(0, 2000));
      $app.save(o);   // сообщение клиенту отправит хук на смену статуса
      const token = s.get("tg_token");
      shop.adminIds(s).forEach((chat) => shop.tg(token, "sendMessage", {
        chat_id: chat, text: `🔄 Заказ №${o.get("number")}: ${name} (из МоегоСклада)`,
      }));
    } catch (err) { console.log("ms-status", err); }
  });
});
