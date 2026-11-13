/// <reference path="../pb_data/types.d.ts" />
// Спеццены 13.11.2026 на два сорта, по просьбе владельца.
//
//   Спешл Дайменшн 40 см — 11/25/51/101 за 2 490 / 3 990 / 7 990 / 13 990 ₽
//   Йелоу Баблз   50 см — 11/25/51/101 за 2 990 / 3 990 / 7 990 / 13 990 ₽
//
// Каждому сорту — СВОЙ прайс, общий «Кустовые розы пионовидные» не трогаем:
// на нём сидят Мисс Бомбастик, Кэти Грандмас, Лавендер Баблз, Супер Сенсейшен
// и другие, и правка общей клетки уронила бы цену всем.
//
// Прайс обязан покрывать ВСЕ ростовки карточки, иначе размер пропадёт с сайта
// молча. Поэтому в таблицах есть и те длины, где цена обычная: у Спешл
// Дайменшн это 50 и 70, у Йелоу Баблз — 60 и 70 на случай будущего привоза.
const ОБЫЧНЫЕ = {                       // клетки «Кустовых пионовидных» на 13.11
  "40": { "11": 2990, "25": 5990, "51": 11990, "101": 21990 },
  "50": { "11": 3490, "25": 6990, "51": 13990, "101": 24990 },
  "60": { "11": 3990, "25": 7990, "51": 14990, "101": 26990 },
  "70": { "11": 4490, "25": 8990, "51": 16990, "101": 29990 },
};

migrate((app) => {
  const s = app.findFirstRecordByFilter("settings", "id != ''");
  let т = [];
  try { т = JSON.parse(s.getString("price_tables") || "[]") || []; } catch (_) { т = []; }

  const добавить = (id, name, prices) => {
    if (т.some((x) => x.id === id)) return;
    т.push({ id, name, counts: [11, 25, 51, 101], def_count: 11, prices });
  };

  добавить("special-dim", "Спешл Дайменшн 40 — спеццена", {
    "40": { "11": 2490, "25": 3990, "51": 7990, "101": 13990 },
    "50": ОБЫЧНЫЕ["50"], "60": ОБЫЧНЫЕ["60"], "70": ОБЫЧНЫЕ["70"],
  });
  добавить("yelou", "Йелоу Баблз 50 — спеццена", {
    "40": ОБЫЧНЫЕ["40"],
    "50": { "11": 2990, "25": 3990, "51": 7990, "101": 13990 },
    "60": ОБЫЧНЫЕ["60"], "70": ОБЫЧНЫЕ["70"],
  });

  app.db().newQuery("UPDATE settings SET price_tables = {:v} WHERE id = {:id}")
    .bind({ v: JSON.stringify(т), id: s.id }).execute();

  // Карточки на свои прайсы. Запросом, мимо хуков: обычное сохранение карточки
  // затирает карту остатков в пустоту — на этом уже обжигались трижды.
  app.db().newQuery("UPDATE products SET price_table = 'special-dim' WHERE id = 'hh3aj5mwkmnz2zk'").execute();
  app.db().newQuery("UPDATE products SET price_table = 'yelou' WHERE id = 'umlixtyjgyxlo5f'").execute();

  // Остаток Спешл Дайменшн: карточку правили в админке, и `stock` стал пустым —
  // то есть «продаём без ограничения». Возвращаем сегодняшний пересчёт.
  app.db().newQuery(`UPDATE products SET stock = '{"40":1960,"50":99,"70":0}'
    WHERE id = 'hh3aj5mwkmnz2zk' AND (stock IS NULL OR stock = '' OR stock = '{}')`).execute();

  // Наверх витрины venikoff. Закрепы сильнее любого яруса сортировки, но
  // наличие сильнее закрепа: кончится сорт — всё равно уедет вниз.
  const b = app.findFirstRecordByFilter("brands", "slug = 'venikoff'");
  let пины = [];
  try { пины = JSON.parse(b.getString("tile_pins") || "[]") || []; } catch (_) { пины = []; }
  пины = ["hh3aj5mwkmnz2zk"].concat(пины.filter((x) => x !== "hh3aj5mwkmnz2zk"));
  app.db().newQuery("UPDATE brands SET tile_pins = {:v} WHERE id = {:id}")
    .bind({ v: JSON.stringify(пины), id: b.id }).execute();
}, (app) => {
  app.db().newQuery("UPDATE products SET price_table = 'spray-peony' WHERE id IN ('hh3aj5mwkmnz2zk','umlixtyjgyxlo5f')").execute();
});
