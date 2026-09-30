/// <reference path="../pb_data/types.d.ts" />
// Догоняющая рассылка, первая партия: пять человек.
// Предыдущая попытка упала — шаг «nps» ещё не был разрешён в поле «шаг».
migrate((app) => {
  try {
    const r = require(`${__hooks}/lib/review.js`).blast(app, 5, false);
    console.log("рассылка опроса (5):", JSON.stringify(r));
  } catch (err) { console.log("рассылка опроса", err); }
}, () => {});
