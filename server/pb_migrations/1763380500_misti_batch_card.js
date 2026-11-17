/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const description = "Ярко-розовая пионовидная роза цвета фуксии: густомахровый бутон раскрывается широкой розеткой. Партия 1 200 стеблей, длина 40 см. 21 роза — 2 990 ₽, 51 роза — 6 990 ₽, 101 роза — 13 990 ₽. Продаём по специальной цене, пока партия не разойдётся. Фото букета пришлём до отправки.";
  app.db().newQuery(`UPDATE products SET lengths = {:lengths}, description = {:description}
    WHERE id = {:id} AND price_table = {:table} AND batch_total = 1200`)
    .bind({ lengths: JSON.stringify([40]), description,
      id: "oghyzgr5n0kdnc1", table: "misti-batch-20261117" }).execute();
}, (app) => {});
