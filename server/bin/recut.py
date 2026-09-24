#!/usr/bin/env python3
"""Перерезает фон у всех товаров разом.

Запуск: recut.py <адрес> <токен> [--only-missing]
Модель загружается один раз, поэтому на снимок уходит пара секунд, а не семь,
как в задании по одному. Пригодится, когда меняли фото пачкой или улучшили вырезку.
"""
import sys, os, io, requests
sys.path.insert(0, "/opt/venikoff/bin")
from PIL import Image, ImageOps
from rembg import remove, new_session
import pillow_heif

pillow_heif.register_heif_opener()

STORAGE = "/opt/venikoff/pb/pb_data/storage"
WIDTH = 640
MAX_IN = 1400

def cut(session, src, flowers=False):
    im = ImageOps.exif_transpose(Image.open(src))
    if im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((MAX_IN, MAX_IN), Image.LANCZOS)
    out = remove(im, session=session, post_process_mask=True)
    if flowers:                      # у букетов отрезаем упаковку
        from flowers import flowers_only
        out, _ = flowers_only(out)
    box = out.getbbox()
    if box:
        out = out.crop(box)
    if out.width > WIDTH:
        out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
    buf = io.BytesIO()
    out.save(buf, "WEBP", quality=88, method=6)
    return buf.getvalue(), out.size

def main(base, token, only_missing):
    head = {"Authorization": token}
    r = requests.get(f"{base}/api/collections/products/records?perPage=300&expand=category", headers=head, timeout=60)
    r.raise_for_status()
    items = r.json()["items"]
    # упаковку отрезаем только у цветов: у игрушек и открыток это испортило бы картинку
    def is_flowers(p):
        cat = ((p.get("expand") or {}).get("category") or {}).get("name", "")
        return any(w in cat.lower() for w in ("роз", "гортенз", "цвет", "букет"))

    session = new_session("u2net")
    done = failed = skipped = 0

    for p in items:
        photos = p.get("photo") or []
        if not photos:
            skipped += 1
            continue
        if only_missing and p.get("cutout"):
            skipped += 1
            continue
        src = os.path.join(STORAGE, p["collectionId"], p["id"], photos[0])
        if not os.path.exists(src):
            print(f"нет файла: {p['name']}")
            failed += 1
            continue
        try:
            data, size = cut(session, src, is_flowers(p))
            up = requests.patch(
                f"{base}/api/collections/products/records/{p['id']}",
                headers=head,
                files={"cutout": (f"cut_{p['id']}.webp", data, "image/webp")},
                data={"cut_done": "true"},
                timeout=120,
            )
            up.raise_for_status()
            done += 1
            print(f"{done}. {p['name']} — {size[0]}x{size[1]}")
        except Exception as err:
            failed += 1
            print(f"не вышло: {p['name']}: {err}")

    print(f"готово: {done}, пропущено: {skipped}, с ошибкой: {failed}")

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit("нужно: recut.py <адрес> <токен> [--only-missing]")
    main(sys.argv[1].rstrip("/"), sys.argv[2], "--only-missing" in sys.argv)
