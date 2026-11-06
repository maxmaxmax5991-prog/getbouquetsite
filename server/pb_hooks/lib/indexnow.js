// IndexNow — быстрая переобходка страниц Яндексом и Bing.
//
// Обычно новая или изменённая страница ждёт, пока робот сам до неё доберётся:
// недели. IndexNow переворачивает это: мы сами говорим поисковику «вот эти
// адреса изменились», и Яндекс приходит в тот же день. Протокол открытый,
// аккаунт и подтверждение прав не нужны — нужен только файл с ключом на домене.
// Google IndexNow не поддерживает, там работает обычный sitemap.
//
// Ключ лежит в настройках (settings.indexnow_key) и отдаётся по адресу
// https://домен/<ключ>.txt — иначе поисковик не поверит, что домен наш.
const shop = require(`${__hooks}/lib/shop.js`);

const ТОЧКА = "https://api.indexnow.org/indexnow";
const ЗА_РАЗ = 10000;        // ограничение протокола

function ключ(app) {
  const s = shop.settings(app);
  let k = String(s.get("indexnow_key") || "").trim();
  if (k) return k;
  // Ключ — просто длинная случайная строка. Заводим сами при первом обращении.
  k = $security.randomStringWithAlphabet(40, "abcdef0123456789");
  try {
    app.db().newQuery("UPDATE settings SET indexnow_key = {:v} WHERE id = {:id}").bind({ v: k, id: s.id }).execute();
  } catch (err) { console.log("indexnow: не сохранил ключ", err); }
  return k;
}

// Отправить список адресов одного домена
function отправить(app, host, urls) {
  const список = (urls || []).filter(Boolean).slice(0, ЗА_РАЗ);
  if (!список.length) return { ok: true, отправлено: 0 };
  const k = ключ(app);
  try {
    const res = $http.send({
      url: ТОЧКА,
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: k, keyLocation: `https://${host}/${k}.txt`, urlList: список }),
      timeout: 30,
    });
    // 200 и 202 — принято; 422 обычно значит, что ключ ещё не виден на домене
    const ок = res.statusCode === 200 || res.statusCode === 202;
    if (!ок) console.log("indexnow", host, res.statusCode, String(res.body ? toString(res.body) : "").slice(0, 200));
    return { ok: ок, код: res.statusCode, отправлено: список.length };
  } catch (err) {
    console.log("indexnow: не ушло", host, err);
    return { ok: false, error: String(err) };
  }
}

// Все адреса витрины: главная, разделы, карточки товаров
function адреса(app, brand) {
  const page = require(`${__hooks}/lib/page.js`);
  const host = String((brand && brand.get("domain")) || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host) return { host: "", urls: [] };
  const кат = shop.catalog(app, brand);
  const разделы = (кат.categories || []).filter((c) => !c.addon).map((c) => `/catalog/${c.slug}/`);
  const товары = (кат.products || []).filter((p) => !p.off).map((p) => `/catalog/${p.cat}/${p.slug || p.id}/`);
  const все = ["/", "/catalog/", "/delivery/", "/price/"].concat(разделы).concat(товары);
  return { host, urls: все.map((u) => `https://${host}${u}`) };
}

// Прогнать все витрины целиком. Зовём после правки текстов и раз в сутки.
function всё(app) {
  const итог = [];
  let brands = [];
  try { brands = app.findRecordsByFilter("brands", "active = true && domain != ''", "sort", 20, 0); } catch (_) {}
  brands.forEach((b) => {
    const { host, urls } = адреса(app, b);
    if (!host) return;
    const r = отправить(app, host, urls);
    итог.push(`${host}: ${r.ok ? "принято " + r.отправлено : "не вышло (" + (r.код || r.error) + ")"}`);
  });
  return итог;
}

module.exports = { ключ, отправить, адреса, всё };
