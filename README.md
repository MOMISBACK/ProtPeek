# ProtPeek

**View protein structures without leaving the paper you're reading.**

ProtPeek is a free, open-source browser extension for Firefox and Chromium. It detects structural identifiers in scientific articles and opens the corresponding structures in the browser side panel.

It is intended for quick inspection while reading, not as a replacement for PyMOL, ChimeraX, Coot, or other full molecular-modelling tools.

[Chrome Web Store](https://chromewebstore.google.com/detail/protpeek/mjiidagjpbabdncmgpabcijgndnbemck) · [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/protpeek/) · [Privacy](https://momisback.github.io/ProtPeek/privacy/)

![ProtPeek showing PDB 1AON](./store-assets/protpeek-640x400.png)

## Features

- Detects PDB, UniProt, and AlphaFold identifiers in web articles.
- Loads structures from RCSB PDB and AlphaFold DB.
- Opens local `.pdb`, `.cif`, `.mmcif`, and `.bcif` files.
- Shows chains, sequences, residues, ligands, colours, and molecular representations.
- Supports residue selection, focus/isolation, chain visibility, and surface rendering.
- Exports the visible structure as PDBx/mmCIF and the current view as PNG.
- No account, analytics, ads, telemetry, or ProtPeek-operated backend.

Article scanning and local-file processing happen on the device. ProtPeek only contacts RCSB PDB or AlphaFold DB when you explicitly open a remote structure.

## Development

Requirements: Node.js 22+ and npm.

```sh
npm ci
npm run dev:firefox
# or
npm run dev:chrome
```

Checks:

```sh
npm run typecheck
npm run lint
npm test
npm run build:firefox
npm run build:chrome
npm run verify:build
```

Release archives:

```sh
npm run release
```

Main source areas:

- `src/article/` — identifier detection in article content
- `src/structures/` — identifier parsing and structure loading
- `src/viewer/` — Mol* integration
- `src/ui/` — side-panel UI
- `tests/` — Vitest test suite

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution notes and [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## Licence

ProtPeek source code is distributed under the [Mozilla Public License 2.0](./LICENSE).

The viewer uses [Mol*](https://molstar.org/). Third-party licences are listed in [public/THIRD_PARTY_NOTICES.txt](./public/THIRD_PARTY_NOTICES.txt).
