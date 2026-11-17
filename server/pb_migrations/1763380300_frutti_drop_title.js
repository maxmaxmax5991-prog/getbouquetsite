/// <reference path="../pb_data/types.d.ts" />
// Меняем только подпись; продажи, остаток лотов и очередь сохраняются.
migrate((app) => {
  let d = null;
  try { d = app.findFirstRecordByFilter("drops", "date = {:d}", { d: "2026-11-17" }); } catch (_) {}
  if (!d) return;
  let lots = [];
  try { lots = JSON.parse(d.getString("lots") || "[]"); } catch (_) {}
  if (!Array.isArray(lots) || !lots.some((l) => l.product === "fruttibablz001")) return;
  app.db().newQuery("UPDATE drops SET note = {:note} WHERE id = {:id}")
    .bind({ note: "Суперцена на Фрутти Баблз", id: d.id }).execute();
}, (app) => {});
