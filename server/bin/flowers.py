#!/usr/bin/env python3
"""Оставляет на снимке только сами цветы: без упаковки и без человека.

rembg вырезает весь передний план — вместе с бумагой и тем, кто держит букет.
Дальше убираем лишнее двумя приёмами:
  1) лицо и руки (цвет кожи) и тёмную одежду — они всегда мешают;
  2) упаковку по цвету: бумага почти бесцветная, лепестки нет. Этот приём
     работает только когда середина букета цветная; у пастельных гортензий
     он бессилен, поэтому включается не всегда.
Потом берём самый большой оставшийся кусок — это и есть шапка букета.
Если срезалось бы слишком много, оставляем снимок как был: лучше с бумагой,
чем без половины букета.
"""
import sys
import numpy as np
from PIL import Image, ImageOps
from skimage.color import rgb2lab, rgb2ycbcr
from scipy.ndimage import binary_fill_holes, binary_closing, binary_opening, binary_dilation, label
from rembg import remove, new_session
import pillow_heif

pillow_heif.register_heif_opener()

WIDTH, MAX_IN = 640, 1400
NEAR = 26.0        # насколько цвет может отличаться от середины букета
MIN_CHROMA = 7.0   # бледнее — по цвету упаковку не отделить
DARK_L = 22.0      # темнее этого считаем одеждой или тенью
MIN_KEEP = 0.30    # меньше этой доли не оставляем: значит, приём ошибся

def biggest(mask):
    lbl, n = label(mask)
    if n == 0:
        return None
    sizes = np.bincount(lbl.ravel()); sizes[0] = 0
    return lbl == sizes.argmax()

def flowers_only(rgba):
    a = np.asarray(rgba)
    alpha = a[..., 3] > 128
    if alpha.sum() < 100:
        return rgba, "пусто"

    rgb = a[..., :3] / 255.0
    lab = rgb2lab(rgb)
    ycc = rgb2ycbcr(a[..., :3])
    cb, cr = ycc[..., 1], ycc[..., 2]

    # середина букета — опора: там точно цветы, и по ней проверяем, не ошиблись ли приёмы
    ys, xs = np.nonzero(alpha)
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    ry, rx = max(8, (ys.max() - ys.min()) // 6), max(8, (xs.max() - xs.min()) // 6)
    core = np.zeros_like(alpha)
    core[max(0, cy - ry):cy + ry, max(0, cx - rx):cx + rx] = True
    core &= alpha

    skin = (cb >= 77) & (cb <= 127) & (cr >= 133) & (cr <= 173) & (lab[..., 0] > 30)
    dark = lab[..., 0] < DARK_L
    note = []
    # бледно-розовые лепестки похожи на кожу: если «кожа» нашлась в середине букета,
    # значит приём ошибается — не применяем его
    if core.sum() and (skin & core).sum() / core.sum() > 0.25:
        skin = np.zeros_like(skin)
    elif (skin & alpha).mean() > 0.01:
        note.append("убрали человека")
    mask = alpha & ~skin & ~dark
    core &= mask
    if core.sum() > 50:
        mid = np.median(lab[core], axis=0)
        chroma = float(np.hypot(mid[1], mid[2]))
        if chroma >= MIN_CHROMA:
            d = np.sqrt((lab[..., 1] - mid[1]) ** 2 + (lab[..., 2] - mid[2]) ** 2)
            mask = mask & (d < NEAR)
            note.append("убрали упаковку")

    mask = binary_opening(mask, np.ones((7, 7)))       # мелкие остатки одежды отваливаются
    mask = binary_closing(mask, np.ones((15, 15)))
    mask = binary_fill_holes(mask)
    big = biggest(mask)
    if big is None:
        return rgba, "ничего не нашлось"
    big = binary_fill_holes(binary_dilation(big, np.ones((5, 5))))

    share = big.sum() / alpha.sum()
    if share < MIN_KEEP:
        return rgba, f"срезалось бы {100 - 100 * share:.0f}% — оставляем как есть"

    out = a.copy()
    out[..., 3] = np.where(big, a[..., 3], 0)
    return Image.fromarray(out), (", ".join(note) or "без изменений") + f", осталось {100 * share:.0f}%"

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
    out.save(dst, "WEBP", quality=88, method=6)
    print(f"{out.width}x{out.height} — {note}")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
