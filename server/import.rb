# encoding: utf-8
# Переносит каталог из data.js (и фото из img/) в базу PocketBase.
# Запуск: ruby server/import.rb http://127.0.0.1:8091 EMAIL PASSWORD
# Повторный запуск ничего не дублирует: товары ищутся по legacy_id.
require "json"
require "open3"

BASE, EMAIL, PASS = ARGV
abort "ruby import.rb URL EMAIL PASSWORD" unless PASS
ROOT = File.expand_path("..", __dir__)

def curl(*args)
  out, err, st = Open3.capture3("curl", "-s", "-S", *args)
  abort "curl: #{err}" unless st.success?
  JSON.parse(out)
end

auth = curl("-X", "POST", "#{BASE}/api/collections/_superusers/auth-with-password",
            "-H", "content-type: application/json", "-d", { identity: EMAIL, password: PASS }.to_json)
TOKEN = auth["token"] or abort("Не удалось войти: #{auth}")
H = ["-H", "Authorization: #{TOKEN}"]

cats = curl(*H, "#{BASE}/api/collections/categories/records?perPage=100")["items"].to_h { |c| [c["slug"], c["id"]] }
existing = curl(*H, "#{BASE}/api/collections/products/records?perPage=1000&fields=id,legacy_id")["items"].to_h { |p| [p["legacy_id"], p["id"]] }

def save(id, fields, files)
  args = H + (id ? ["-X", "PATCH", "#{BASE}/api/collections/products/records/#{id}"] : ["-X", "POST", "#{BASE}/api/collections/products/records"])
  fields.each { |k, v| args += ["-F", "#{k}=#{v.is_a?(String) ? v : v.to_json}"] }
  files.each { |field, paths| paths.each { |p| args += ["-F", "#{field}=@#{p}"] } }
  r = curl(*args)
  abort "Ошибка сохранения #{fields[:name]}: #{r}" unless r["id"]
  r
end

src = File.read(File.join(ROOT, "data.js"), encoding: "utf-8")
data = JSON.parse(src[/window\.PRODUCTS = (\[.*?\]);/m, 1])
popular = %w[3159 3137 3136 3174 3178 3176 3035 2178]
n = 0

# 1. Одноголовые розы venikoff (цена — из прайса «длина × количество» в настройках)
[
  ["sweet-avalanche", "Свит Аваланж", [50, 60], "Нежность в каждом лепестке", "#E8A3B0"],
  ["abigail",         "Абигейл",      [50],     "Ярко, как первое свидание",  "#E0418A"],
  ["miss-piggy",      "Мисс Пигги",   [60],     "Тёплый персиковый привет",   "#F09A7A"],
  ["eltoro",          "Эльторо",      [40],     "Красные розы. Всё понятно",  "#C8102E"],
  ["peach-avalanche", "Пич Аваланж",  [50, 60], "Мягкий свет персика",        "#F2B98A"],
].each_with_index do |(slug, name, lengths, mood, tint), i|
  next if existing[slug]
  save(nil, { name: name, category: cats["single"], price: 0, lengths: lengths, active: true, popular: true, featured: true,
              mood: mood, tint: tint, sort: i, legacy_id: slug },
       { "photo" => [File.join(ROOT, "img/v/#{slug}.jpg")], "cutout" => [File.join(ROOT, "img/cut/#{slug}.png")] })
  n += 1
end

# 2. Линейки роз и гортензии: у каждого размера своя цена и фото
data.each_with_index do |p, i|
  next if existing[p["id"]]
  if p["variants"]
    photo_ids = p["variants"].map { |v| v["photo"] || p["id"] }.uniq
    rec = save(nil, { name: p["name"], category: cats[p["cat"]], price: p["price"], bonus: p["bonus"] || 0, active: true,
                      popular: popular.include?(p["id"]), sort: 10 + i, legacy_id: p["id"] },
               { "photo" => photo_ids.map { |id| File.join(ROOT, "img/p/#{id}.jpg") } })
    names = photo_ids.zip(rec["photo"]).to_h
    variants = p["variants"].map { |v| { label: v["label"], price: v["price"], photo: names[v["photo"] || p["id"]] }.merge(v["est"] ? { estimated: true } : {}) }
    save(rec["id"], { variants: variants }, {})
  else
    save(nil, { name: p["name"], category: cats[p["cat"]], price: p["price"], bonus: p["bonus"] || 0, active: true, sort: 100 + i, legacy_id: p["id"] },
         { "photo" => [File.join(ROOT, "img/p/#{p["id"]}.jpg")] })
  end
  n += 1
end
puts "Добавлено товаров: #{n}"
