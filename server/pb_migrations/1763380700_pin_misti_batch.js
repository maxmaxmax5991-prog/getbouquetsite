/// <reference path="../pb_data/types.d.ts" />
// Партия Мисти должна быть видна в основной плитке, а не только на /drop/.
migrate((app) => {
  const id = "oghyzgr5n0kdnc1";
  const b = app.findFirstRecordByFilter("brands", "domain = {:domain}", { domain: "venikoff.net" });
  let pins = [];
  try { pins = JSON.parse(b.getString("tile_pins") || "[]"); } catch (_) {}
  if (!Array.isArray(pins)) pins = [];
  const next = [id].concat(pins.filter((x) => String(x) !== id));
  app.db().newQuery("UPDATE brands SET tile_pins = {:pins} WHERE id = {:id}")
    .bind({ pins: JSON.stringify(next), id: b.id }).execute();
}, (app) => {});
