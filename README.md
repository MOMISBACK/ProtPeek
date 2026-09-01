# ProtPeek

ProtPeek is a focused protein-structure viewer that lives in the browser side panel. It is designed for quickly moving from a scientific article to an interactive 3D structure without opening a full molecular-modelling application.

Version `0.1.1` provides one Manifest V3 codebase for Firefox and Chromium, a custom lightweight interface, and Mol* as the rendering engine.

## What it does

- Opens in Firefox's sidebar or Chromium's side panel.
- Scans the active article locally for contextual structure references in text, official links, metadata, and JSON-LD.
- Refreshes detections when the active tab changes, navigation completes, or article content is updated while the panel is open.
- Accepts legacy and extended PDB IDs, UniProt accessions, and AlphaFold IDs.
- Loads remote PDB structures as BinaryCIF with an mmCIF fallback.
- Resolves UniProt and AlphaFold identifiers through AlphaFold DB.
- Reads local `.cif`, `.mmcif`, `.bcif`, and `.pdb` files without uploading them.
- Downloads the currently visible structure as a PDBx/mmCIF `.cif` file generated locally in the browser.
- Shows chains, virtualized sequences, missing residues, and detected ligands.
- Supports residue selection, reversible focus and isolation, direct chain visibility, selection colouring, and global or selected-residue representations, with visible active states.
- Initializes Mol* in parallel with structure acquisition on the first explicit load, reuses that viewer, and cancels superseded loads.
- Follows the operating-system light or dark theme.

## Supported input

| Input | Examples | Behaviour |
| --- | --- | --- |
| PDB | `1ABC`, `8xyz` | RCSB BinaryCIF, then mmCIF fallback |
| Extended PDB | `pdb_00001abc`, `pdb_1000axyz` | Future-proof PDBx/mmCIF identifier handling |
| UniProt | `P69905` | Resolves the corresponding AlphaFold prediction |
| AlphaFold | `AF-P69905-F1` | Selects the matching prediction from AlphaFold metadata |
| Local | `.cif`, `.mmcif`, `.bcif`, `.pdb` | Parsed and rendered locally; 512 MiB safety limit |

Remote structure payloads use the same 512 MiB safety ceiling.

Residue expressions include `254`, `C254`, `A:254`, `A:C254`, `A:254,278,281`, and `A:254-281`. A chain must be specified when a chainless expression would be ambiguous.

## Using ProtPeek

1. Click the ProtPeek toolbar action while viewing an HTTP or HTTPS article. The current page is scanned and the side panel opens.
2. Select a detected PDB, UniProt, or AlphaFold reference, enter an identifier manually, or drop/choose a supported local file.
3. Rotate, pan, and zoom in the viewer. Expand **Customize structure** below it to inspect chains, ligands, sequences, and residue selections; this panel starts collapsed for each structure. Focus, Isolate, chain visibility, and selection colours expose their active state and can be toggled back; **Show all** restores the complete view.
4. Use the download button above the viewer to save the currently visible structure as a locally generated PDBx/mmCIF `.cif` file. Hidden or isolated parts are omitted from that export.
5. Select an exact identifier in a web page and use **View in ProtPeek** from the context menu for a direct load.

Firefox asks for ProtPeek to start in the navigation toolbar. To keep ProtPeek
one click away if the browser still places it in the **Extensions** menu, choose
**Pin** or **Pin to Toolbar** next to ProtPeek. Chrome and Chromium keep initial
toolbar pinning under browser and user control, so an extension cannot force
itself to remain pinned during installation. Once visible, clicking the
ProtPeek icon opens its native side panel or sidebar directly.

Automatic refresh requires access to HTTP and HTTPS pages. ProtPeek uses that
access only to scan the active tab locally while its panel is open, or after an
explicit toolbar click; it does not send article contents anywhere. Newly
opened tabs, completed navigations, in-page route changes, and article content
added after load are rescanned automatically. A small refresh button in the
panel header is available for an immediate manual rescan. Browser-internal and
other restricted pages still cannot be scanned.

ProtPeek uses each browser's native sidebar/side-panel surface. Its left or
right placement follows the browser-wide user preference and cannot be forced
by an extension. Firefox exposes this under **Customize sidebar**; Chromium
exposes it in the browser's appearance settings.

## Development

Requirements:

- Node.js 22 or newer
- npm

Install the locked dependencies:

```sh
npm ci
```

Start a development browser:

```sh
npm run dev:firefox
npm run dev:chrome
```

Create production builds:

```sh
npm run build:firefox
npm run build:chrome
```

WXT writes the unpacked builds to `.output/firefox-mv3` and
`.output/chrome-mv3`. The hidden `.output/` directory is generated locally,
ignored by Git, and may be deleted and rebuilt at any time; it is a working
directory, not the public release location.

The `npm run release` pipeline creates the browser archives, makes a complete
source archive from the clean Git `HEAD` (including the test suite), verifies
the builds, and copies all three archives into the visible
[`release/`](./release/) directory for inspection. These generated ZIP files
are intentionally ignored by Git; official binaries and source archives are
published on the matching GitHub Release. See
[`release/README.md`](./release/README.md) for the expected filenames.

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev:firefox` | Run WXT in Firefox development mode |
| `npm run dev:chrome` | Run WXT in Chromium development mode |
| `npm run build:firefox` | Build the Firefox MV3 extension |
| `npm run build:chrome` | Build the Chromium MV3 extension |
| `npm run verify:build` | Verify both built manifests, permissions, CSP, icons, and target-specific panel declarations |
| `npm run zip:firefox` | Produce a Firefox submission archive with WXT |
| `npm run zip:chrome` | Produce a Chromium submission archive with WXT |
| `npm run release:sources` | Archive the exact clean Git `HEAD`, including tests, as the release sources |
| `npm run release:copy` | Copy existing verified archives from `.output/` into visible `release/` |
| `npm run release` | Build, verify, and copy the browser and source release archives |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run lint` | Run ESLint over the repository |
| `npm run typecheck` | Run strict TypeScript checking without emitting files |
| `npm run capture:store` | Capture and verify the real Firefox store screenshot and 1AON-derived icons |
| `npm run benchmark` | Run deterministic Node CPU microbenchmarks; this is not a GPU benchmark |
| `npm run prepare` | Generate WXT types and preparation artefacts |

A useful pre-publication check is:

```sh
npm run typecheck
npm run lint
npm test
npm run build:firefox
npm run build:chrome
npm run verify:build
```

`verify:build` reads the generated manifests, so both production builds must exist first.

### Store assets

The tracked [640×400 store screenshot](./store-assets/protpeek-640x400.png)
and [128×128 store icon](./store-assets/protpeek-icon-128.png) are real
captures of ProtPeek rendering the experimental GroEL–GroES–(ADP)7 complex
[PDB 1AON](https://www.rcsb.org/structure/1AON). They are not mock-ups, and no
generative AI was used to create them.

After creating a Firefox archive, regenerate and dimension-check the assets
with:

```sh
npm run zip:firefox
npm run capture:store
```

The capture script temporarily installs the Firefox archive, loads 1AON
through the normal ProtPeek interface, records the exact 640×400 viewport, and
derives the molecule-only 128×128 icon locally. It requires Firefox and
geckodriver; their paths can be supplied through `PROTPEEK_FIREFOX_BINARY` and
`PROTPEEK_GECKODRIVER`.

### Chrome WebGL smoke harness

The repository includes a real-browser CDP smoke client. After loading the built extension in a Chrome instance started with remote debugging, open the ProtPeek panel and run:

```sh
node scripts/chrome-smoke-client.mjs \
  '<panel-CDP-websocket-url>' \
  '/absolute/path/to/tests/fixtures/minimal.cif' \
  'pdb_00001crn'
```

The optional final argument exercises a remote replacement load; use `P69905` for the AlphaFold path. The harness verifies lazy Mol* startup, a narrow `320 × 700` layout, local CIF/WebGL loading, metadata, residue interaction, reversible focus/isolation and chain visibility, selected-residue representations, surface rendering, colouring, the local download control, and optional remote replacement. It is currently a manual Chrome smoke test rather than an npm script or a cross-browser E2E suite. The final headless Chrome 145 run passed functionally, but used SwiftShader and measured only 1.1 fps during synthetic rotation; this is below the intended interactive target and is not representative of hardware-GPU performance.

## Architecture

```text
Article → active panel scan → ArticleStructureScanner
                                ↓ detected structure ID
                              ProtPeekApp
                              ├─ structure acquisition
                              └─ lazy Mol* import and initialization
                                ↓ both ready
                              Mol* / WebGL
  ↓ metadata and interaction events
ProtPeek UI
```

Chromium and Firefox share the same background logic, side-panel document, UI, loaders, and viewer. The small `BrowserAdapter` boundary centralizes the `sidePanel`/`sidebarAction` difference. See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.

Measured CPU and integration results, their limits, and the still-missing release measurements are recorded in [PERFORMANCE.md](./PERFORMANCE.md).

## Local execution and network access

ProtPeek's engine and 100% of its executable code run locally in the browser.
Every JavaScript module, including Mol*, is packaged with the extension;
ProtPeek never downloads remote executable code or delegates processing to a
project-operated backend.

The only application network traffic is structure-data retrieval from the
official RCSB or AlphaFold services, and it occurs only after the user
explicitly requests a remote identifier. Scanning an article, opening a local
file, parsing structures, rendering, and interacting with the viewer all run on
the user's device. The complete boundary is documented in
[TRANSPARENCY.md](./TRANSPARENCY.md).

## Privacy and permissions

ProtPeek has no analytics, advertising, user account, tracking endpoint, or ProtPeek-operated backend. Article scanning happens locally, and local structure files are never uploaded. Network requests are limited to the official RCSB and AlphaFold hosts required to retrieve a structure selected by the user.

The store-facing policy is published at
[momisback.github.io/ProtPeek/privacy/](https://momisback.github.io/ProtPeek/privacy/).
See [PRIVACY.md](./PRIVACY.md) for the versioned policy, exact data flow, and
an explanation of every permission.

## Licence, contributions, and trademarks

ProtPeek is distributed under the
[Mozilla Public License 2.0](./LICENSE). Issues and pull requests are welcome;
see [CONTRIBUTING.md](./CONTRIBUTING.md). Passing checks or opening a pull
request does not grant merge authority: a contribution is merged only after
explicit approval from **MOMISBACK**.

The MPL-2.0 covers the code but does not grant rights to the reserved ProtPeek
name, logo, or related brand assets. See [TRADEMARKS.md](./TRADEMARKS.md) before
publishing a fork or modified distribution.

## Known limitations

- Bare UniProt-like tokens in ordinary prose are intentionally ignored unless an explicit database label, trusted metadata field, or official service URL establishes their meaning.
- Scanning covers the main document only. Restricted browser pages, extension stores, and inaccessible frames cannot be scanned.
- Detection is contextual but heuristic; candidates are confirmed only when a load succeeds.
- The viewer displays one structure and the model/asymmetric unit at a time; biological-assembly selection is not yet exposed.
- Gzipped local files and author insertion-code syntax in the text selection field are not yet supported.
- Surface rendering is explicit and can still be expensive for very large structures.
- Real Chrome and Firefox WebGL smoke runs pass, but remain manual. Chrome used SwiftShader, while Firefox's WebGL portion ran in the same extension page opened as a tab because WebDriver cannot enter the native remote sidebar document; automated cross-browser E2E and representative hardware-GPU measurements are not yet present.
