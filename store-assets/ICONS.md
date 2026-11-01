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
