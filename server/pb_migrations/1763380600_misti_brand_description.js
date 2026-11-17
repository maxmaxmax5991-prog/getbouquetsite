/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const p = app.findRecordById("products", "oghyzgr5n0kdnc1");
  if (p.get("price_table") !== "misti-batch-20261117") return;
  const brand = app.findFirstRecordByFilter("brands", "domain = {:domain}", { domain: "venikoff.net" });
  const texts = JSON.parse(p.getString("texts_by") || "{}");
  const description = "Ярко-розовая пионовидная роза цвета фуксии: густомахровый бутон раскрывается широкой розеткой. Партия 1 200 стеблей, длина 40 см. 21 роза — 2 990 ₽, 51 роза — 6 990 ₽, 101 роза — 13 990 ₽. Продаём по специальной цене, пока партия не разойдётся. Фото букета пришлём до отправки.";
  texts[brand.id] = Object.assign({}, texts[brand.id] || {}, { d: description });
  app.db().newQuery("UPDATE products SET texts_by = {:texts} WHERE id = {:id}")
    .bind({ texts: JSON.stringify(texts), id: p.id }).execute();
}, (app) => {});
