/// <reference path="../pb_data/types.d.ts" />
// Третья витрина — LasFlore (lasflore.ru, решение владельца 05.10.2026).
// Сайт переезжает с Битрикса на этот движок: товары и прайс общие с venikoff,
// своё у LasFlore — логотип, цвета, стиль ([data-brand="lasflore"] в index.html)
// и тексты. Пока домен смотрит на старый хостинг, витрину видно только
// предпросмотром: https://venikoff.net/?brand=lasflore
// Бота, терминала CloudPayments и буквы счёта тут нет — их вводят в админке.
migrate((app) => {
  let b = null;
  try { b = app.findFirstRecordByFilter("brands", "slug = 'lasflore'"); } catch (_) {}
  if (b) return;   // уже заведена руками — не трогаем
  const col = app.findCollectionByNameOrId("brands");
  b = new Record(col);
  b.set("slug", "lasflore");
  b.set("name", "LasFlore");
  b.set("domain", "lasflore.ru");
  b.set("accent", "#FF6A1F");
  b.set("accent_text", "#D9520C");
  b.set("accent_dark", "#FF7A33");
  b.set("accent_text_dark", "#FF9A5C");
  b.set("tag_color", "#FF6A1F");
  b.set("phone", "+7 (495) 922-13-37");
  b.set("address", "Москва, Маленковская улица, 14к1");
  b.set("active", true);
  b.set("sort", 3);
  b.set("hero_eyebrow", "Цветочная мастерская в Москве с 2010 года");
  b.set("hero_title", "Дарите цветы");
  b.set("hero_em", "чаще.");
  b.set("hero_text", "Собираем букеты из свежих цветов и привозим по Москве. Перед отправкой пришлём фото — вы увидите букет раньше, чем его получат.");
  b.set("seo_title", "LasFlore — доставка цветов и букетов по Москве");
  b.set("seo_description", "LasFlore — букеты, розы и гортензии с доставкой по Москве. Фото букета перед отправкой, свои курьеры.");
  b.set("texts", {
    perk1_t: "🌿 Свежие цветы", perk1_d: "регулярные поставки от проверенных теплиц",
    perk2_t: "💐 Соберём к сроку", perk2_d: "доставка по Москве в удобный вам интервал",
    perk3_t: "📸 Фото перед доставкой", perk3_d: "увидите букет раньше, чем его получат",
    studio_bar: "Подберём букет *за минуту*", studio_title: "Какой букет подарим?",
    ready_note: "Отличный выбор — такой букет запомнят.",
    perkA_t: "Фото букета", perkA_d: "Пришлём перед отправкой — без сюрпризов",
    perkB_t: "Свои курьеры", perkB_d: "Бережно довезём по Москве в ваш интервал",
    perkC_t: "Открытка в подарок", perkC_d: "Напишем ваш текст от руки",
    popular_title: "Любимые букеты наших покупателей",
    cat_note: "Свежие цветы и честные цены — доставка по Москве",
    price_note: "Цена за букет целиком. Доставку посчитаем по адресу при оформлении.",
    foot_slogan: "Дарите цветы чаще",
  });
  // Логотип лежит в папке сайта (img/brand) — выкладка кладёт его туда раньше,
  // чем перезапускается сервер. Не нашёлся — витрина будет с названием текстом.
  const dir = $os.getenv("VENIKOFF_SITE") || "/opt/venikoff/site";
  try { b.set("logo", $filesystem.fileFromPath(dir + "/img/brand/lasflore.svg")); } catch (err) { console.log("lasflore logo", err); }
  try { b.set("logo_dark", $filesystem.fileFromPath(dir + "/img/brand/lasflore-dark.svg")); } catch (err) { console.log("lasflore logo dark", err); }
  app.save(b);
}, (app) => {
  try { app.delete(app.findFirstRecordByFilter("brands", "slug = 'lasflore'")); } catch (_) {}
});
