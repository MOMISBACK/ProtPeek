# ProtPeek

**View protein structures without leaving the paper you're reading.**

ProtPeek is a free, open-source browser extension for Firefox and Chromium. It scans the scientific article you are reading for structural identifiers and lets you open the corresponding protein structures directly in the browser side panel.

ProtPeek is meant for **quick inspection while reading**, not as a replacement for PyMOL, ChimeraX, Coot, or other full molecular-modelling applications.

[Chrome Web Store](https://chromewebstore.google.com/detail/protpeek/mjiidagjpbabdncmgpabcijgndnbemck) · [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/protpeek/) · [Privacy](https://momisback.github.io/ProtPeek/privacy/)

![ProtPeek showing PDB 1AON](./store-assets/protpeek-640x400.png)

## What it does

- Detects contextual **PDB, UniProt, and AlphaFold identifiers** in web articles.
- Opens detected structures in the browser sidebar/side panel.
- Loads PDB structures from **RCSB PDB** and predicted models from **AlphaFold DB**.
- Supports local `.pdb`, `.cif`, `.mmcif`, and `.bcif` files.
- Lets you inspect chains, sequences, residues, ligands, colours, and representations.
- Supports focus, isolation, chain visibility, residue selection, and surface rendering.
- Exports the visible structure as PDBx/mmCIF and the current view as a high-resolution PNG.
- Runs without an account, analytics, advertising, or a ProtPeek backend.

## How it works

```text
Scientific article
      ↓
local page scan
      ↓
PDB / UniProt / AlphaFold identifier
      ↓
RCSB PDB or AlphaFold DB
      ↓
Mol* viewer in the browser side panel
```

Article scanning happens locally. ProtPeek does not reconstruct structures from the paper: it detects identifiers already present on the page and retrieves the corresponding existing structure when you choose to open it.

## Supported input

| Input | Example | Source |
| --- | --- | --- |
| PDB | `1ABC` | RCSB PDB |
| Extended PDB | `pdb_00001abc` | RCSB PDB |
| UniProt | `P69905` | AlphaFold DB |
| AlphaFold | `AF-P69905-F1` | AlphaFold DB |
| Local structure | `.pdb`, `.cif`, `.mmcif`, `.bcif` | Your device |

## Using ProtPeek

1. Open a scientific article and click the ProtPeek toolbar button.
2. ProtPeek scans the active page locally and lists detected structures under **Page**.
3. Select a structure to open it in the side panel.
4. Rotate, zoom, inspect chains/residues/ligands, or customize the representation.
5. You can also enter an identifier manually, load a local structure file, or select an identifier on a page and use **View in ProtPeek** from the context menu.

## Privacy

ProtPeek has no analytics, ads, accounts, telemetry, or project-operated backend. Article scanning and local-file processing stay on your device.

Remote requests are made only when you explicitly open a structure, and are limited to the official RCSB PDB and AlphaFold services.

See [PRIVACY.md](./PRIVACY.md) and [docs/TRANSPARENCY.md](./docs/TRANSPARENCY.md) for details.

## Development

Requirements: Node.js 22+ and npm.

```sh
npm ci
npm run dev:firefox
# or
npm run dev:chrome
```

Validate the project with:

```sh
npm run typecheck
npm run lint
npm test
npm run build:firefox
npm run build:chrome
npm run verify:build
```

Production archives can be generated with:

```sh
npm run release
```

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [Performance notes and measurements](./docs/PERFORMANCE.md)
- [Privacy policy](./PRIVACY.md)
- [Transparency and network boundary](./docs/TRANSPARENCY.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
- [Trademark policy](./docs/TRADEMARKS.md)

## Licence

ProtPeek source code is distributed under the [Mozilla Public License 2.0](./LICENSE).

The viewer is powered by [Mol*](https://molstar.org/). Third-party components remain subject to their respective licences.
