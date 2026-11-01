# ProtPeek icon

`protpeek-icon-master.png` is the 512 × 512 RGBA master extracted from the
approved large article-and-protein logo, without the wordmark or preview tiles.
The detached right page-border stroke and isolated ribbon fragment are absent.
The background and the spaces around the ribbon are transparent.

The extension and Zotero share the matching PNGs in `public/`:
`icon-16.png`, `icon-32.png`, `icon-48.png`, `icon-96.png`, and `icon-128.png`.
Use `public/icon-128.png` for the 128 × 128 store image.

To regenerate these sizes without changing the design, from the repository
root with Python and Pillow installed:

```python
from pathlib import Path
from PIL import Image

master = Image.open('store-assets/protpeek-icon-master.png').convert('RGBA')
for size in (16, 32, 48, 96, 128):
    master.resize((size, size), Image.Resampling.LANCZOS).save(
        Path('public') / f'icon-{size}.png', optimize=True,
    )
```

## Toolbar contrast

Toolbar buttons use `public/icon-toolbar-{16,32}.png`: the approved mark with a
thin light keyline for contrast on both light and dark backgrounds. Firefox
also receives `icon-toolbar-light-{16,32}.png` through `action.theme_icons`,
which selects the pale variant when the toolbar uses light text.

Regenerate these variants with `python scripts/generate-toolbar-icons.py`
(Pillow required). Shape and transparency come directly from the approved
master. The standard store/management icons are unchanged.

Firefox's `light`/`dark` keys refer to the theme's text/icon colour, not the
background colour. See [Mozilla's action manifest documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/action#theme_icons).
