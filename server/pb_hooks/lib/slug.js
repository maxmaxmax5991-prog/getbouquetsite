// Адрес товара из названия: «Букет Ночной дуэт» → «buket-nochnoy-duet».
// Транслитерация та же, что у Битрикса на lasflore.ru (kh, ts, shch, y),
// чтобы адреса старого сайта и новые выглядели одинаково.
const MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function make(name) {
  const s = String(name || "").toLowerCase().split("").map((c) => (MAP[c] !== undefined ? MAP[c] : c)).join("");
  return s.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, "") || "tovar";
}

// Свободный адрес: занят — добавляем -2, -3… Свой собственный адрес занятым не считается.
function unique(app, name, selfId) {
  const base = make(name);
  for (let i = 1; i < 200; i++) {
    const s = i === 1 ? base : `${base}-${i}`;
    let taken = null;
    try { taken = app.findFirstRecordByFilter("products", "slug = {:s}", { s }); } catch (_) {}
    if (!taken || taken.id === selfId) return s;
  }
  return `${base}-${String(selfId || Date.now()).slice(-6)}`;
}

module.exports = { make, unique };
