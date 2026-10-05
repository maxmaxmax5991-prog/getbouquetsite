// Страницы сайта для поисковиков.
//
// Сайт рисуется в браузере, но Яндекс и Google должны получить готовую страницу:
// свой заголовок, описание, текст, цену и ссылки дальше. Caddy присылает сюда
// каждый адрес, за которым нет файла (и главную), с исходным адресом в X-Page-Uri.
// Мы берём index.html, подставляем в него заголовки и текст страницы и отдаём.
// Покупатель видит то же самое, только скрипт потом рисует живую витрину.
//
// Адреса:
//   /                               главная
//   /catalog/                       весь каталог
//   /catalog/<раздел>/              раздел
//   /catalog/<раздел>/<товар>/      товар (раздел не тот — 301 на верный)
//   /delivery/                      доставка
//   /me/ /favorites/ /order/<код>/  личное — отдаём, но закрываем от поиска
//   /sitemap.xml /robots.txt        у каждой витрины свои
// Таблица redirects переводит старые адреса (lasflore.ru на Битриксе) на новые.

const brandLib = require(`${__hooks}/lib/brand.js`);
const shop = require(`${__hooks}/lib/shop.js`);

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rub = (n) => Math.round(+n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₽";
const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

function siteDir() { return $os.getenv("VENIKOFF_SITE") || "/opt/venikoff/site"; }

function shell() {
  return toString($os.readFile(siteDir() + "/index.html"));
}

// Адрес, который запросил человек. Caddy кладёт его в X-Page-Uri; без Caddy
// (проверка на своём компьютере) — в ?u=.
function requested(e) {
  let u = "";
  try { u = String(e.request.header.get("X-Page-Uri") || ""); } catch (_) {}
  if (!u) { try { u = String(e.request.url.query().get("u") || ""); } catch (_) {} }
  if (!u) u = "/";
  const q = u.indexOf("?");
  const path = decodeURIComponent(q >= 0 ? u.slice(0, q) : u) || "/";
  return { path, query: q >= 0 ? u.slice(q + 1) : "" };
}

function originOf(e, brand) {
  let h = brandLib.hostOf(e);
  if (!h || h === "127.0.0.1" || h === "localhost") h = brand && brand.get("domain") ? String(brand.get("domain")) : h;
  return (h && h.indexOf("127.0.0.1") < 0 && h.indexOf("localhost") < 0 ? "https://" : "http://") + (h || "localhost");
}

// Старый адрес → новый. Своя витрина важнее общей записи.
function redirectFor(app, brand, path) {
  const keys = [path, path.replace(/\/$/, ""), path.endsWith("/") ? path : path + "/"];
  for (let i = 0; i < keys.length; i++) {
    let rows = [];
    try { rows = app.findRecordsByFilter("redirects", "from = {:f}", "", 10, 0, { f: keys[i] }); } catch (_) {}
    const mine = rows.find((r) => brand && r.get("brand") === brand.id) || rows.find((r) => !r.get("brand"));
    if (mine) {
      try { app.db().newQuery("UPDATE redirects SET hits = COALESCE(hits,0) + 1 WHERE id = {:id}").bind({ id: mine.id }).execute(); } catch (_) {}
      return String(mine.get("to") || "/");
    }
  }
  return "";
}

function productUrl(p) { return `/catalog/${p.cat}/${p.slug || p.id}/`; }

// Всё, что нужно странице: каталог витрины, разделы с текстами, настройки
function load(app, brand) {
  const cat = shop.catalog(app, brand);
  const cats = app.findRecordsByFilter("categories", "active = true", "sort", 100, 0);
  const catInfo = {};
  cats.forEach((c) => catInfo[c.get("slug")] = c);
  const live = cat.products.filter((p) => !p.off);
  return { cat, catInfo, live };
}

function page(meta, body) { return { meta, body }; }

function homePage(ctx, brand) {
  const name = brand ? brand.get("name") : "venikoff.net";
  const title = (brand && brand.get("seo_title")) || `${name} — доставка цветов и букетов по Москве`;
  const desc = (brand && brand.get("seo_description")) || clip(`${name}: ${(brand && brand.get("hero_text")) || "букеты и розы с доставкой по Москве"}`, 200);
  const sections = ctx.cat.categories.filter((c) => !c.addon && ctx.live.some((p) => p.cat === c.slug));
  const top = ctx.live.filter((p) => p.popular).concat(ctx.live.filter((p) => !p.popular)).filter((p) => !ctx.cat.categories.find((c) => c.slug === p.cat && c.addon)).slice(0, 24);
  const body = `<h1>${esc(title)}</h1>
<p>${esc((brand && brand.get("hero_text")) || "")}</p>
<h2>Каталог</h2><ul>${sections.map((c) => `<li><a href="/catalog/${esc(c.slug)}/">${esc(c.name)}</a></li>`).join("")}</ul>
<h2>Популярные букеты</h2><ul>${top.map((p) => `<li><a href="${productUrl(p)}">${esc(p.name)}</a> — от ${rub(p.price)}</li>`).join("")}</ul>
<p><a href="/delivery/">Доставка по Москве</a></p>`;
  return page({ title, desc, path: "/", type: "website" }, body);
}

function listBody(ctx, items) {
  return `<ul class="ssr-list">${items.map((p) => `<li><a href="${productUrl(p)}">${p.img ? `<img src="${esc(p.img)}" alt="${esc(p.name)}" width="280" height="280" loading="lazy">` : ""}${esc(p.name)}</a> — ${p.soldout ? "нет в наличии" : "от " + rub(p.price)}</li>`).join("")}</ul>`;
}

function catalogPage(ctx, brand, slug) {
  const name = brand ? brand.get("name") : "venikoff.net";
  if (!slug) {
    const items = ctx.live.filter((p) => !ctx.cat.categories.find((c) => c.slug === p.cat && c.addon));
    const title = `Каталог букетов с доставкой по Москве — ${name}`;
    return page({ title, desc: clip(`Все букеты ${name}: ${items.length} позиций с ценами и фото. Доставка по Москве.`, 200), path: "/catalog/", crumbs: [["Каталог", "/catalog/"]] },
      `<h1>Каталог</h1>${listBody(ctx, items)}`);
  }
  const c = ctx.catInfo[slug];
  if (!c) return null;
  const items = ctx.live.filter((p) => p.cat === slug);
  const title = c.get("seo_title") || `${c.get("name")} с доставкой по Москве — ${name}`;
  const text = String(c.get("seo_text") || "");
  const desc = c.get("seo_description") || clip(`${c.get("name")} в ${name}: ${items.length ? items.length + " вариантов, от " + rub(Math.min.apply(null, items.map((p) => p.price))) + "." : ""} Доставка по Москве, фото букета перед отправкой.`, 200);
  return page({ title, desc, path: `/catalog/${slug}/`, crumbs: [["Каталог", "/catalog/"], [c.get("name"), `/catalog/${slug}/`]] },
    `<h1>${esc(c.get("name"))}</h1>${text ? `<div class="ssr-text">${text.split(/\n{2,}/).map((t) => `<p>${esc(t)}</p>`).join("")}</div>` : ""}${listBody(ctx, items)}`);
}

function productPage(ctx, brand, p) {
  const name = brand ? brand.get("name") : "venikoff.net";
  const c = ctx.catInfo[p.cat];
  const cname = c ? c.get("name") : "";
  const prices = (p.variants || []).filter((v) => !v.out).map((v) => v.price);
  const low = prices.length ? Math.min.apply(null, prices) : p.price;
  const high = prices.length ? Math.max.apply(null, prices) : p.price;
  const title = `${p.name} — купить с доставкой по Москве, от ${rub(low)} | ${name}`;
  const desc = clip(p.description ? `${p.name}: ${p.description}` : `${p.name} от ${rub(low)} с доставкой по Москве. ${cname}. Фото букета перед отправкой.`, 200);
  const path = productUrl(p);
  const sizes = (p.variants || []).map((v) => `<li>${esc(shop.labelText ? shop.labelText(v.label) : v.label)} — ${v.out ? "нет в наличии" : rub(v.price)}</li>`).join("");
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.name,
    image: [p.big || p.img].filter(Boolean),
    description: clip(p.description || `${p.name} — ${cname}`, 500),
    category: cname || undefined,
    offers: prices.length > 1
      ? { "@type": "AggregateOffer", priceCurrency: "RUB", lowPrice: low, highPrice: high, offerCount: prices.length, availability: p.soldout ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" }
      : { "@type": "Offer", priceCurrency: "RUB", price: low, availability: p.soldout ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" },
  };
  return page({ title, desc, path, image: p.big || p.img, type: "product", ld,
    crumbs: [["Каталог", "/catalog/"]].concat(c ? [[cname, `/catalog/${p.cat}/`]] : []).concat([[p.name, path]]) },
    `<h1>${esc(p.name)}</h1>
${p.big || p.img ? `<img src="${esc(p.big || p.img)}" alt="${esc(p.name)}" width="540" height="540">` : ""}
<p>${p.soldout ? "Сейчас нет в наличии" : `Цена: от ${rub(low)}`}</p>
${sizes ? `<ul>${sizes}</ul>` : ""}
${p.description ? `<p>${esc(p.description)}</p>` : ""}
${c ? `<p>Раздел: <a href="/catalog/${esc(p.cat)}/">${esc(cname)}</a></p>` : ""}`);
}

function deliveryPage(brand) {
  const name = brand ? brand.get("name") : "venikoff.net";
  return page({ title: `Доставка цветов по Москве — ${name}`, desc: `Доставка букетов ${name} по Москве: цена по адресу, интервалы, фото букета перед отправкой.`, path: "/delivery/", crumbs: [["Доставка", "/delivery/"]] },
    `<h1>Доставка по Москве</h1><p>Введите адрес — сайт сразу покажет стоимость доставки. Перед отправкой присылаем фото букета.</p>`);
}

function head(meta, origin, brand) {
  const url = origin + (meta.path || "/");
  const name = brand ? brand.get("name") : "venikoff.net";
  const ld = [];
  if (meta.ld) {
    if (meta.ld.image) meta.ld.image = meta.ld.image.map((u) => (u.indexOf("http") === 0 ? u : origin + u));
    ld.push(meta.ld);
  }
  if (meta.crumbs && meta.crumbs.length) {
    ld.push({ "@context": "https://schema.org", "@type": "BreadcrumbList",
      itemListElement: [["Главная", "/"]].concat(meta.crumbs).map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c[0], item: origin + c[1] })) });
  }
  if (meta.path === "/" && brand) {
    ld.push({ "@context": "https://schema.org", "@type": "Florist", name, url: origin + "/",
      telephone: brand.get("phone") || undefined,
      address: brand.get("address") ? { "@type": "PostalAddress", streetAddress: brand.get("address"), addressLocality: "Москва", addressCountry: "RU" } : undefined });
  }
  return [
    meta.noindex ? `<meta name="robots" content="noindex, follow">` : `<link rel="canonical" href="${esc(url)}">`,
    `<meta property="og:site_name" content="${esc(name)}">`,
    `<meta property="og:type" content="${meta.type === "product" ? "product" : "website"}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.desc)}">`,
    `<meta property="og:url" content="${esc(url)}">`,
    meta.image ? `<meta property="og:image" content="${esc(origin + meta.image)}">` : "",
    ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, "\\u003c")}</script>`).join(""),
  ].filter(Boolean).join("\n");
}

// Оформление витрины прямо в отданной странице: цвета, логотип, свои тексты.
// Иначе до загрузки каталога человек видел бы розовый venikoff — на lasflore.ru
// это выглядело бы как чужой сайт. Скрипт потом ставит то же самое ещё раз.
function dress(html, brand) {
  if (!brand) return html;
  const b = brandLib.pub(brand);
  const rgba = (hex, a) => {
    const m = String(hex).replace("#", "");
    const n = parseInt(m.length === 3 ? m.split("").map((c) => c + c).join("") : m, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  };
  html = html.replace('<html lang="ru">', `<html lang="ru" data-brand="${esc(b.slug)}">`);
  if (b.accent) {
    const set = (c, t, s1, s2) => `--accent:${c};--accent-text:${t};--accent-soft:${rgba(c, s1)};--accent-soft-2:${rgba(c, s2)}`;
    const dk = b.accent_dark || b.accent;
    const light = set(b.accent, b.accent_text || b.accent, .08, .17), dark = set(dk, b.accent_text_dark || dk, .14, .26);
    html = html.replace("</head>", `<style>:root{${light}}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${dark}}}:root[data-theme="dark"]{${dark}}</style>\n</head>`)
      .replace(/<meta name="theme-color" content="[^"]*">/, `<meta name="theme-color" content="${esc(b.accent)}">`);
  }
  if (b.slug !== "venikoff") {
    const logo = b.logo
      ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" class="logo-img"><img src="${esc(b.logo_dark || b.logo)}" alt="${esc(b.name)}" class="logo-img logo-dark">`
      : esc(b.name);
    html = html.replace(/(<a class="logo" id="logo(?:Top|Foot)"[^>]*>)[\s\S]*?(<\/a>)/g, `$1${logo}$2`);
  }
  const put = (id, text) => { if (text) html = html.replace(new RegExp(`(<[a-z0-9]+[^>]*id="${id}"[^>]*>)[\\s\\S]*?(</)`), `$1${esc(text)}$2`); };
  put("heroEyebrow", b.hero_eyebrow);
  put("heroText", b.hero_text);
  if (b.hero_title || b.hero_em) {
    html = html.replace(/(<h1 id="heroTitle">)[\s\S]*?(<\/h1>)/, `$1${esc(b.hero_title || "")}${b.hero_em ? ` <em>${esc(b.hero_em)}</em>` : ""}$2`);
  }
  const T = b.texts || {};
  html = html.replace(/(<([a-z0-9]+)[^>]*\sdata-t="([a-z0-9_]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (all, open, tag, key, inner, close) =>
    T[key] ? open + esc(T[key]).replace(/\*([^*]+)\*/g, "<b>$1</b>") + close : all);
  if (b.address || T.foot_slogan) {
    const lines = [b.address, T.foot_slogan || "Оптовые цены в розницу", `© ${b.name}, ${new Date().getFullYear()}`].filter(Boolean).map(esc).join("<br>");
    html = html.replace(/(<span id="footAbout">)[\s\S]*?(<\/span>)/, `$1${lines}$2`);
  }
  if (b.tg_link) html = html.replace(/(<a [^>]*id="footTg" href=")[^"]*/, `$1${esc(b.tg_link)}`);
  return html;
}

function render(html, meta, body, origin, brand) {
  html = dress(html, brand);
  const crumbs = meta.crumbs && meta.crumbs.length
    ? `<nav class="ssr-crumbs"><a href="/">Главная</a>${meta.crumbs.map((c) => ` / <a href="${esc(c[1])}">${esc(c[0])}</a>`).join("")}</nav>` : "";
  return html
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(meta.title)}</title>`)
    .replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${esc(meta.desc)}">`)
    .replace("</head>", head(meta, origin, brand) + "\n</head>")
    // текст страницы — в начало main; когда скрипт нарисует витрину, блок уберётся
    .replace("<main>", `<main>\n<div id="ssr" class="wrap ssr">${crumbs}${body}</div>`);
}

function sitemap(ctx, origin) {
  const urls = ["/", "/catalog/", "/delivery/"]
    .concat(ctx.cat.categories.filter((c) => !c.addon && ctx.live.some((p) => p.cat === c.slug)).map((c) => `/catalog/${c.slug}/`))
    .concat(ctx.live.filter((p) => !ctx.cat.categories.find((c) => c.slug === p.cat && c.addon)).map(productUrl));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `<url><loc>${esc(origin + u)}</loc></url>`).join("\n") + `\n</urlset>\n`;
}

function robots(origin) {
  return `User-agent: *\nDisallow: /admin/\nDisallow: /add/\nDisallow: /api/\nDisallow: /me/\nDisallow: /favorites/\nDisallow: /order/\nDisallow: /*?*q=\nClean-param: len&cnt&q&brand&utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function serve(app, e) {
  const { path, query } = requested(e);
  let brand = brandLib.byHost(app, e);
  // ?brand=<имя> — предпросмотр витрины до подключения её домена (как у каталога)
  const want = (query.match(/(?:^|&)brand=([a-z0-9_-]+)/i) || [])[1];
  if (want) brand = brandLib.list(app).find((b) => String(b.get("slug")).toLowerCase() === want.toLowerCase()) || brand;
  const origin = originOf(e, brand);
  const keepQ = query ? "?" + query : "";

  if (path === "/robots.txt") { e.response.header().set("Content-Type", "text/plain; charset=utf-8"); return e.string(200, robots(origin)); }

  const moved = redirectFor(app, brand, path);
  if (moved && moved !== path) return e.redirect(301, moved);

  const ctx = load(app, brand);
  if (path === "/sitemap.xml") {
    e.response.header().set("Content-Type", "application/xml; charset=utf-8");
    e.response.header().set("Cache-Control", "public, max-age=3600");
    return e.string(200, sitemap(ctx, origin));
  }

  // Адреса страниц всегда со слэшем на конце: один адрес — одна страница
  if (path !== "/" && !path.endsWith("/") && !/\.[a-z0-9]{2,5}$/i.test(path)) return e.redirect(301, path + "/" + keepQ);

  const parts = path.split("/").filter(Boolean);
  let out = null, status = 200;
  if (path === "/index.html") return e.redirect(301, "/" + keepQ);
  if (!parts.length) out = homePage(ctx, brand);
  else if (parts[0] === "catalog" && parts.length <= 2) out = catalogPage(ctx, brand, parts[1]);
  else if (parts[0] === "catalog" && parts.length === 3) {
    const p = ctx.cat.products.find((x) => x.slug === parts[2]) || ctx.cat.products.find((x) => x.id === parts[2]);
    if (p) {
      const want = productUrl(p);
      if (want !== path) return e.redirect(301, want + keepQ);
      out = productPage(ctx, brand, p);
    }
  }
  else if (parts[0] === "p" && parts[1]) {
    // короткая ссылка /p/<id> — ведём на постоянный адрес товара
    const p = ctx.cat.products.find((x) => x.id === parts[1] || x.slug === parts[1]);
    if (p) return e.redirect(301, productUrl(p));
  }
  else if (parts[0] === "delivery" && parts.length === 1) out = deliveryPage(brand);
  else if (["me", "favorites", "order", "studio"].indexOf(parts[0]) >= 0) {
    const name = brand ? brand.get("name") : "venikoff.net";
    out = page({ title: name, desc: "", path, noindex: true }, "");
  }

  if (!out) {
    status = 404;
    const name = brand ? brand.get("name") : "venikoff.net";
    out = page({ title: `Страница не найдена — ${name}`, desc: "", path, noindex: true },
      `<h1>Такой страницы нет</h1><p><a href="/catalog/">Перейти в каталог</a></p>`);
  }
  e.response.header().set("Cache-Control", "no-cache");
  return e.html(status, render(shell(), out.meta, out.body, origin, brand));
}

module.exports = { serve, productUrl };
