# SPDX-License-Identifier: MPL-2.0
"""Export toolbar sizes from the approved blue icon; requires Pillow."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
master = Image.open(ROOT / 'store-assets/protpeek-icon-master.png').convert('RGBA')
# The original white ribbon on its cobalt tile provides its own contrast.
# Both Firefox theme variants use this same approved artwork: do not recolour
# the ribbon or replace it with the approximate mockup mark.
for size in (16, 32):
    for name in ('toolbar', 'toolbar-light'):
        master.resize((size, size), Image.Resampling.LANCZOS).save(
            ROOT / 'public' / f'icon-{name}-{size}.png', optimize=True,
        )
