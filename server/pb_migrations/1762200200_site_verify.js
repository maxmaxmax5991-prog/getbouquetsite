/// <reference path="../pb_data/types.d.ts" />
// Подтверждение прав на домены в Яндекс.Вебмастере и Google Search Console.
// Оба сервиса дают файл с выдуманным именем и содержимым, который должен
// открываться в корне сайта. Складываем их сюда:
//   {"yandex_xxx.html": "<содержимое>", "google123.html": "...", "meta:venikoff.net": "<meta …>"}
// Ключи вида "meta:домен" — это мета-тег, который надо вставить в <head>
// именно этого домена; остальные ключи — файлы, они отдаются на всех витринах.
migrate((app) => {
  const s = app.findCollectionByNameOrId("settings");
  if (!s.fields.getByName("site_verify")) s.fields.add(new Field({ name: "site_verify", type: "json", maxSize: 100000 }));
  app.save(s);
}, (app) => {
  const s = app.findCollectionByNameOrId("settings");
  s.fields.removeByName("site_verify");
  app.save(s);
});
