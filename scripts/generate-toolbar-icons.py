# SPDX-License-Identifier: MPL-2.0
"""Generate toolbar variants from the approved mark; requires Pillow."""
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
master = Image.open(ROOT / 'store-assets/protpeek-icon-master.png').convert('RGBA')
alpha = master.getchannel('A')
# A 0.625 px keyline at 16 px, scaled for high-DPI rendering. The approved
# coloured artwork is composited over it without changing the original shape.
keyline = Image.new('RGBA', master.size, (245, 248, 255, 0))
keyline.putalpha(alpha.filter(ImageFilter.MaxFilter(41)))
keyline.alpha_composite(master)

# Firefox's light-text theme variant: pale strokes and blue ribbon returns.
# Keep alpha/geometry from the approved artwork, changing only its palette.
light = master.copy()
colours = []
pixels = (master.getpixel((x, y)) for y in range(master.height) for x in range(master.width))
for r, g, b, a in pixels:
    luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    t = max(0, min(1, (luminance - 0.15) / 0.55))
    white, blue = (248, 250, 255), (158, 211, 255)
    colours.append(tuple(round(w + (c - w) * t) for w, c in zip(white, blue)) + (a,))
light.putdata(colours)
for size in (16, 32):
    for name, image in [('toolbar', keyline), ('toolbar-light', light)]:
        image.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / 'public' / f'icon-{name}-{size}.png', optimize=True,
        )
