#!/usr/bin/env python3
"""Переводит снимок с айфона (HEIC) в обычный JPEG.

Запуск: tojpg.py вход.heic выход.jpg
Поворот по метке ориентации применяем сразу, иначе фото ляжет набок.
"""
import sys
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

MAX = 3000        # больше на сайте всё равно не нужно, а весит втрое меньше

def main(src, dst):
    im = Image.open(src)
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "L"):
        im = im.convert("RGB")
    if max(im.size) > MAX:
        im.thumbnail((MAX, MAX), Image.LANCZOS)
    im.save(dst, "JPEG", quality=92, optimize=True, progressive=True)
    print(f"{im.width}x{im.height}")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("нужно: tojpg.py вход выход")
    main(sys.argv[1], sys.argv[2])
