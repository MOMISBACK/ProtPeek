# ProtPeek release artefacts

Run `npm run release` to build and zip Firefox and Chrome, verify both generated
manifests, and copy the three current-version ZIP files from `.output/` into
this visible directory. Generated ZIP files are intentionally ignored by Git;
official binaries are attached to the matching GitHub Release.

Expected files for version `0.1.0`:

- `ProtPeek-0.1.0-chrome.zip`
- `ProtPeek-0.1.0-firefox.zip`
- `ProtPeek-0.1.0-sources.zip`
