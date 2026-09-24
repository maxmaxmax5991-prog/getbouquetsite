#!/usr/bin/env python3
"""Вырезает букет с фото и сохраняет PNG без фона — для карусели на главной.

Запуск: cutout.py вход.jpg выход.png
Модель u2net скачивается один раз в ~/.u2net и дальше работает без интернета.
Картинку заранее уменьшаем: на 1400 точках качество маски то же, а памяти
и времени нужно втрое меньше — на сервере всего 2 ГБ.
"""
import sys
from PIL import Image, ImageOps
from rembg import remove, new_session
import pillow_heif

pillow_heif.register_heif_opener()   # снимки с айфона тоже открываем

WIDTH = 640          # столько же, сколько у вырезанных вручную
MAX_IN = 1400

def main(src, dst):
    im = ImageOps.exif_transpose(Image.open(src))
    if im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((MAX_IN, MAX_IN), Image.LANCZOS)

    out = remove(im, session=new_session("u2net"), post_process_mask=True)

    box = out.getbbox()          # обрезаем прозрачные поля по краям
    if box:
        out = out.crop(box)
    if out.width > WIDTH:
        out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
    out.save(dst, "PNG", optimize=True)
    print(f"{out.width}x{out.height}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("нужно: cutout.py вход выход")
    main(sys.argv[1], sys.argv[2])
