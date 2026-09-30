/// <reference path="../pb_data/types.d.ts" />
// Догоняющая рассылка опроса, первая партия: пять человек.
// Бьём по всей базе только после того, как убедимся, что письма доходят
// и ответ записывается. Остальных досылаем следующей миграцией.
migrate((app) => {
  try {
    const r = require(`${__hooks}/lib/review.js`).blast(app, 5, false);
    console.log("рассылка опроса (5):", JSON.stringify(r));
  } catch (err) { console.log("рассылка опроса", err); }
}, () => {});
