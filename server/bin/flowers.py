#!/usr/bin/env python3
"""Оставляет только сами цветы: упаковка отрезается по цвету.

Бумага у букета почти бесцветная (серо-белая), а лепестки — цветные.
Берём цвет середины букета и оставляем то, что на него похоже.
Если середина сама бледная, цветом ничего не решишь — тогда оставляем как есть.
"""
import sys
import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab
from scipy.ndimage import binary_fill_holes, binary_closing, binary_opening, label
from rembg import remove, new_session
import pillow_heif

pillow_heif.register_heif_opener()

WIDTH, MAX_IN = 640, 1400
NEAR = 26.0        # насколько цвет может отличаться от середины
MIN_CHROMA = 7.0   # если середина бледнее — по цвету не отделить

def flowers_only(rgba):
    a = np.asarray(rgba)
    alpha = a[..., 3] > 128
    if alpha.sum() < 100:
        return rgba, "пусто"

    lab = rgb2lab(a[..., :3] / 255.0)
    ys, xs = np.nonzero(alpha)
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    h, w = alpha.shape
    ry, rx = max(8, (ys.max() - ys.min()) // 6), max(8, (xs.max() - xs.min()) // 6)
    core = np.zeros_like(alpha)
    core[max(0, cy - ry):cy + ry, max(0, cx - rx):cx + rx] = True
    core &= alpha

    mid = np.median(lab[core], axis=0)
    chroma = float(np.hypot(mid[1], mid[2]))
    if chroma < MIN_CHROMA:
        return rgba, f"середина бледная ({chroma:.1f}) — оставляем как есть"

    d = np.sqrt((lab[..., 1] - mid[1]) ** 2 + (lab[..., 2] - mid[2]) ** 2)
    mask = alpha & (d < NEAR)
    mask = binary_opening(mask, np.ones((5, 5)))
    mask = binary_closing(mask, np.ones((21, 21)))
    mask = binary_fill_holes(mask)

    lbl, n = label(mask)
    if n == 0:
        return rgba, "ничего не нашлось"
    sizes = np.bincount(lbl.ravel()); sizes[0] = 0
    mask = binary_fill_holes(lbl == sizes.argmax())
    if mask.sum() < alpha.sum() * 0.25:
        return rgba, "срезали бы слишком много — оставляем как есть"

    out = a.copy()
    out[..., 3] = np.where(mask, a[..., 3], 0)
    return Image.fromarray(out), f"цвет середины {chroma:.1f}, осталось {100 * mask.sum() / alpha.sum():.0f}%"

def main(src, dst):
    im = ImageOps.exif_transpose(Image.open(src))
    if im.mode != "RGB":
        im = im.convert("RGB")
    im.thumbnail((MAX_IN, MAX_IN), Image.LANCZOS)
    out = remove(im, session=new_session("u2net"), post_process_mask=True)
    out, note = flowers_only(out)
    box = out.getbbox()
    if box:
        out = out.crop(box)
    if out.width > WIDTH:
        out = out.resize((WIDTH, round(out.height * WIDTH / out.width)), Image.LANCZOS)
    out.save(dst, "PNG", optimize=True)
    print(f"{out.width}x{out.height} — {note}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
