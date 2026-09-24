# encoding: utf-8
# Контур кольцевой дороги: делим круг на сектора и в каждом берём медианный радиус.
# Выпуклая оболочка тут не годится — у Садового и ТТК есть заметные вмятины.
require "json"
KY = 110.574
KX = 111.320 * Math.cos(55.75 * Math::PI / 180)

def build(pts, sectors)
  cx = pts.sum { |p| p[0] } / pts.size.to_f
  cy = pts.sum { |p| p[1] } / pts.size.to_f
  buckets = Array.new(sectors) { [] }
  pts.each do |lon, lat|
    x = (lon - cx) * KX; y = (lat - cy) * KY
    r = Math.hypot(x, y)
    next if r < 0.2
    a = Math.atan2(y, x)
    i = ((a + Math::PI) / (2 * Math::PI) * sectors).floor % sectors
    buckets[i] << r
  end
  ring = []
  sectors.times do |i|
    b = buckets[i]
    next if b.empty?
    r = b.sort[b.size / 2]                       # медиана: съезды и развязки не сбивают
    a = -Math::PI + (i + 0.5) * 2 * Math::PI / sectors
    ring << [(cy + r * Math.sin(a) / KY).round(5), (cx + r * Math.cos(a) / KX).round(5)]
  end
  [ring, [cy.round(5), cx.round(5)]]
end

src = JSON.parse(File.read(ARGV[0]))["elements"]
out = {}
src.each do |e|
  name = (e["tags"] || {})["name"].to_s
  key = name.include?("Садовое") ? "sadovoe" : name.include?("Третье") ? "ttk" : "mkad"
  pts = []
  (e["members"] || []).each { |m| (m["geometry"] || []).each { |g| pts << [g["lon"], g["lat"]] } }
  ring, c = build(pts, key == "sadovoe" ? 72 : 90)
  out[key] = ring
  puts "#{name}: точек #{pts.size} → контур #{ring.size}, центр #{c.inspect}"
end
File.write(ARGV[1], JSON.generate(out))
