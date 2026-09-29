/// <reference path="../pb_data/types.d.ts" />
// Грабля: уникальный индекс по tg_chat считал пустые значения одинаковыми.
// В SQLite NULL-ы уникальному индексу не мешают, а пустые строки — мешают.
// Покупатель, пришедший через MAX, сохраняется с пустым tg_chat, поэтому
// зарегистрироваться через MAX мог только ПЕРВЫЙ: всем остальным база отвечала
// «tg_chat: Value must be unique», а человек видел молчание бота.
// Делаем индекс частичным: уникальность нужна только у заполненного чата.
// Заодно заводим такой же для max_chat — его не было вовсе, и один и тот же
// человек мог завестись в базе дважды.
migrate((app) => {
  const c = app.findCollectionByNameOrId("customers");
  c.indexes = ["CREATE UNIQUE INDEX idx_customers_chat ON customers (tg_chat) WHERE tg_chat != ''"];

  // индекс по max_chat ставим, только если дублей ещё нет — иначе база его не примет
  let dupes = 0;
  try {
    const row = new DynamicModel({ n: 0 });
    app.db().newQuery(`SELECT COUNT(*) as n FROM (
      SELECT max_chat FROM customers WHERE max_chat != '' GROUP BY max_chat HAVING COUNT(*) > 1)`).one(row);
    dupes = +row.n;
  } catch (_) {}
  if (!dupes) c.indexes.push("CREATE UNIQUE INDEX idx_customers_max ON customers (max_chat) WHERE max_chat != ''");
  else console.log("customers: пропускаю индекс max_chat —", dupes, "дублей, их надо слить руками");

  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("customers");
  c.indexes = ["CREATE UNIQUE INDEX idx_customers_chat ON customers (tg_chat)"];
  app.save(c);
});
