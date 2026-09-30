/// <reference path="../pb_data/types.d.ts" />
// Догоняющая рассылка опроса, остальные. Первая партия из пяти прошла: письма
// дошли, живой ответ «10» записался, промоутер получил ссылку на Яндекс.Карты.
// Тех, кто уже ответил, blast пропускает сам.
migrate((app) => {
  try {
    const r = require(`${__hooks}/lib/review.js`).blast(app, 1000, false);
    console.log("рассылка опроса (все):", JSON.stringify(r));
  } catch (err) { console.log("рассылка опроса", err); }
}, () => {});
