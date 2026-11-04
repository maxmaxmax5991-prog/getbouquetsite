/// <reference path="../pb_data/types.d.ts" />
// Сервер сам забирает события у MAX (long polling), как и у Телеграма:
// webhook не подходит, снаружи до сервера не достучаться.
//
// По заданию на витрину: вся работа в lib/maxpoll.js, обработчик не видит код
// верхнего уровня этого файла, поэтому номер витрины передаём числом.
// Четыре слота с запасом — лишние молча выходят.
cronAdd("max-poll", "* * * * *", () => { require(`${__hooks}/lib/maxpoll.js`).client($app, 0); });
cronAdd("max-poll-2", "* * * * *", () => { require(`${__hooks}/lib/maxpoll.js`).client($app, 1); });
cronAdd("max-poll-3", "* * * * *", () => { require(`${__hooks}/lib/maxpoll.js`).client($app, 2); });
cronAdd("max-poll-4", "* * * * *", () => { require(`${__hooks}/lib/maxpoll.js`).client($app, 3); });
