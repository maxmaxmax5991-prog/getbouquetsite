// Витрины: какой бренд показывать, решает домен запроса.
// Один код и одна база на оба сайта — различается только оформление,
// набор товаров и клиентский бот. Склад общий: магазин-то один.

// Домен из запроса. За Caddy настоящий адрес приходит в X-Forwarded-Host,
// поэтому смотрим и туда; www и порт отбрасываем.
function hostOf(e) {
  const clean = (v) => String(v || "").toLowerCase().trim().replace(/:\d+$/, "").replace(/^www\./, "");
  let h = "";
  try { const i = e.requestInfo().headers || {}; h = clean(i.x_forwarded_host || i["x-forwarded-host"]); } catch (_) {}
  if (!h) { try { h = clean(e.request.header.get("X-Forwarded-Host")); } catch (_) {} }
  if (!h) { try { h = clean(e.request.host); } catch (_) {} }
  if (!h) { try { h = clean(e.request.header.get("Host")); } catch (_) {} }
  return h;
}

function list(app) {
  try { return app.findRecordsByFilter("brands", "active = true", "sort", 50, 0); } catch (_) { return []; }
}

// Витрина по домену; не узнали — первая по порядку, чтобы сайт не остался пустым.
// ?brand=<имя> — предпросмотр: витрину можно посмотреть до подключения домена.
// Ничего секретного он не открывает: только оформление и набор товаров.
function byHost(app, e) {
  const h = hostOf(e);
  const all = list(app);
  if (!all.length) return null;
  let want = "";
  try { want = String(e.request.url.query().get("brand") || "").toLowerCase().trim(); } catch (_) {}
  if (want) {
    const pick = all.find((b) => String(b.get("slug") || "").toLowerCase() === want);
    if (pick) return pick;
  }
  if (h) {
    const hit = all.find((b) => String(b.get("domain") || "").toLowerCase().replace(/^www\./, "") === h);
    if (hit) return hit;
  }
  return all[0];
}

function byId(app, id) {
  if (!id) return null;
  try { return app.findRecordById("brands", String(id)); } catch (_) { return null; }
}

// Что витрина рассказывает о себе сайту
function pub(b) {
  if (!b) return null;
  return {
    slug: b.get("slug"),
    name: b.get("name"),
    accent: b.get("accent") || "",
    accent_text: b.get("accent_text") || "",
    accent_dark: b.get("accent_dark") || "",
    accent_text_dark: b.get("accent_text_dark") || "",
    hero_eyebrow: b.get("hero_eyebrow") || "",
    hero_title: b.get("hero_title") || "",
    hero_em: b.get("hero_em") || "",
    hero_text: b.get("hero_text") || "",
    tg_link: b.get("tg_link") || "",
    max_link: b.get("max_link") || (b.get("max_bot") ? `https://max.ru/${b.get("max_bot")}` : ""),
    phone: b.get("phone") || "",
    address: b.get("address") || "",
    // свои тексты витрины: ключ — метка data-t на странице
    texts: (function () { try { const t = JSON.parse(b.getString("texts") || "{}"); return t && typeof t === "object" ? t : {}; } catch (_) { return {}; } })(),
    // логотип картинкой; нет — сайт напишет название текстом
    logo: b.get("logo") ? `/api/files/brands/${b.id}/${b.get("logo")}` : "",
    logo_dark: b.get("logo_dark") ? `/api/files/brands/${b.id}/${b.get("logo_dark")}` : "",
  };
}

module.exports = { hostOf, list, byHost, byId, pub };
