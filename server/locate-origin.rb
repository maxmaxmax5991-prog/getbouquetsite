# encoding: utf-8
# Находим координаты магазина по расстояниям, которые отдаёт Геосаджест Яндекса.
# Расстояние считается от точки ll, которую мы передаём, поэтому три замера
# из разных мест однозначно задают искомую точку.
require "json"
require "open-uri"
require "cgi"

KEY = File.read("#{__dir__}/skey.txt").strip
ADDR = ARGV[0] || "Москва, Маленковская улица 14к1"

def measure(lon, lat)
  url = "https://suggest-maps.yandex.ru/v1/suggest?apikey=#{CGI.escape(KEY)}&text=#{CGI.escape(ADDR)}" \
        "&lang=ru&results=1&types=house&ll=#{lon},#{lat}&spn=2,1.5"
  j = JSON.parse(URI.open(url).read)
  r = (j["results"] || []).first
  raise "адрес не найден" unless r && r["distance"]
  [r["distance"]["value"] / 1000.0, r["title"]["text"]]
end

LAT0, LON0 = 55.75, 37.62
KY = 110.574
KX = 111.320 * Math.cos(LAT0 * Math::PI / 180)
to_xy = ->(lon, lat) { [(lon - LON0) * KX, (lat - LAT0) * KY] }

pts = [[37.60, 55.70], [37.80, 55.80], [37.50, 55.85]]
name = nil
meas = pts.map do |lon, lat|
  d, n = measure(lon, lat)
  name ||= n
  x, y = to_xy.(lon, lat)
  puts "из #{lat}, #{lon} → #{d.round(3)} км"
  [x, y, d]
end

# (x-xi)^2+(y-yi)^2 = di^2 — вычитаем первое уравнение из остальных, получаем линейную систему
x1, y1, d1 = meas[0]
rows = meas[1..].map { |x, y, d| [2 * (x - x1), 2 * (y - y1), d1**2 - d**2 + x**2 - x1**2 + y**2 - y1**2] }
a, b, c = rows[0]
e, f, g = rows[1]
det = a * f - b * e
x = (c * f - b * g) / det
y = (a * g - c * e) / det

lat = LAT0 + y / KY
lon = LON0 + x / KX
puts "\n#{name}"
puts "координаты: #{lat.round(6)}, #{lon.round(6)}"

d, = measure(lon, lat)
puts "проверка: от найденной точки до адреса #{(d * 1000).round} м"
File.write("#{__dir__}/origin.txt", "#{lat.round(6)} #{lon.round(6)}")
