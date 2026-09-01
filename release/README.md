# ProtPeek release artefacts

Run `npm run release` from a clean committed working tree to build and zip
Firefox and Chrome, archive the exact Git `HEAD` with its complete test suite,
verify both generated manifests, and copy the three current-version ZIP files
from `.output/` into this visible directory. Generated ZIP files are
intentionally ignored by Git; official binaries and sources are attached to
the matching GitHub Release.

Expected files for version `0.1.1`:

- `ProtPeek-0.1.1-chrome.zip`
- `ProtPeek-0.1.1-firefox.zip`
- `ProtPeek-0.1.1-sources.zip`
