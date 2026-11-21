# ProtPeek icon

`protpeek-icon-master.png` is the 512 × 512 RGBA export of the approved GroEL-only icon: seven white subunits around an open central cavity, on a cobalt rounded tile. CnoX is not included.

The source artwork is the generated GroEL proposal approved by the user. Production exports crop its blue tile at `(10, 10, 1245, 1245)`, remove only the exterior connected white corners and resize the original artwork. No SVG substitute or redrawing is used.

The extension and Zotero use `public/icon-{16,32,48,96,128}.png`. To regenerate them from the approved master:

```python
from pathlib import Path
from PIL import Image

master = Image.open('store-assets/protpeek-icon-master.png').convert('RGBA')
for size in (16, 32, 48, 96, 128):
    master.resize((size, size), Image.Resampling.LANCZOS).save(
        Path('public') / f'icon-{size}.png', optimize=True,
    )
```

Toolbar and Firefox light/dark variants use the same white-on-blue tile. Run `python scripts/generate-toolbar-icons.py` to regenerate them without recolouring or redrawing the approved artwork.
