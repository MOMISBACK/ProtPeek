# ProtPeek architecture

This document describes the implementation in ProtPeek `0.1.2`. The design keeps browser integration, structure acquisition, molecular rendering, and the user interface behind small explicit boundaries.

## System flow

```text
Article page
  │ panel open / active-page change
  ▼
`article-scan.ts`
  │ bounded, serializable page snapshot
  ▼
`ArticleStructureScanner`
  │ validated and deduplicated structure detections
  ▼
background → `storage.session` (keyed by window)
  ▼
`ProtPeekApp`
  │ identifier parsing + latest-request-wins coordination
  ├── local / RCSB / AlphaFold acquisition
  └── `LazyStructureViewer.prepare()`
      dynamic Mol* import and initialization on first structure
  │ both branches complete
  ▼
`MolstarViewer` → Mol* → WebGL
  │ metadata, hover, and selection events
  ▼
`StructurePanel` + `VirtualSequence`
```

For direct context-menu loads, an exact selected identifier is parsed locally and enters the same loading pipeline without scanning the full page.

## Repository map

| Area | Responsibility |
| --- | --- |
| `src/entrypoints/` | WXT background, injected article scan, and shared side-panel entrypoint |
| `src/browser/` | Cross-browser panel opening and session payload keys |
| `src/article/` | Pure contextual PDB, UniProt, and AlphaFold detection over serializable snapshots |
| `src/extension/` | Validation of data crossing injection boundaries and context-menu parsing |
| `src/structures/identifiers/` | PDB, UniProt, and AlphaFold syntax and normalization |
| `src/structures/loaders/` | Local reads, official remote downloads, aborts, fallback, and load errors |
| `src/structures/metadata/` | Ligand aggregation |
| `src/viewer/` | Renderer contract, lazy boundary, Mol* implementation, PDBx/mmCIF export, and adaptive quality |
| `src/sequence/` | Chain deduplication, canonical/observed residue mapping, and selection parsing |
| `src/ui/` | Framework-free DOM application, controls, and virtualized sequence strip |
| `src/performance/` | Development-only timing records and animation-frame sampling |
| `tests/` | Node-based Vitest unit tests for pure logic and loader behaviour |
| `scripts/` | CPU microbenchmarks, generated-manifest verification, release/store-asset automation, and the Chrome CDP smoke client |
| `store-assets/` | Verified real-browser store screenshot, molecule source capture, and store icon |

## Cross-browser boundary

WXT builds a single source tree as Manifest V3 for both targets:

```text
Firefox
  └── `sidebar_action`

Chromium
  └── `side_panel`

Both
  └── the same `sidepanel.html`, background workflow, UI, and viewer
```

`WebExtensionAdapter` feature-detects `browser.sidePanel.open({ windowId })` and `browser.sidebarAction.open()`. No browser condition is spread through the application. WXT adds Chromium's `sidePanel` permission and generates the target-specific manifest keys.

The configured minimums are Chrome 116 and Firefox 140. Firefox receives a background script; Chromium receives a service worker. Background listeners are registered synchronously so the MV3 lifecycle can safely suspend and restore the background context.

## Article scan boundary

Opening the panel and subsequent active-page changes inject the unlisted
`article-scan.js` script once into the active HTTP or HTTPS tab. The manifest
declares those two web-page patterns so switching tabs remains automatic.
There is no manifest-registered persistent content script, no access to local
files, and no access to browser-internal pages.

The injected entrypoint captures one bounded snapshot:

- up to 2,000,000 characters of visible body text;
- up to 5,000 links and 5,000 metadata elements;
- up to 100 JSON-LD scripts;
- the current page URL.

`ArticleStructureScanner` itself has no DOM or WebExtension dependency. Legacy
four-character IDs require explicit PDB context or a trusted official URL;
extended `pdb_XXXXXXXX` and complete AlphaFold IDs can be recognized directly.
Bare UniProt accessions require an adjacent UniProt/Swiss-Prot label, a trusted
metadata or JSON-LD field, or a recognizable official UniProt/AlphaFold URL.
Results are deduplicated, including equivalent `1ABC` and `pdb_00001abc`
spellings.

Only the compact detection array crosses back to the background. `articleStructuresFromScanResult` treats the injected result as untrusted serialized data and validates its complete shape before it reaches the UI.

The injected script also installs one idempotent, debounced mutation monitor.
It sends only a page-changed signal; the live panel then requests another
bounded snapshot. It never transfers DOM mutations or page text.

Scan generations are tracked per browser window. A result from an older tab or
scan cannot overwrite a newer one. Active-tab changes, completed navigations,
in-page route changes, and debounced document mutations request a fresh scan
while the panel is open; the refresh control can request one immediately.

## Identifiers and loading

`parseStructureIdentifier` returns a discriminated PDB, UniProt, or AlphaFold value. Syntax validation is synchronous and separate from checking whether a remote entry exists.

The loaders expose one common `LoadedStructureData` shape:

- local `.cif`, `.mmcif`, and `.pdb` files are read as text;
- local `.bcif` files are read as bytes;
- RCSB loads `https://models.rcsb.org/{id}.bcif`, then falls back to `https://files.rcsb.org/download/{id}.cif`;
- UniProt and AlphaFold input first loads official AlphaFold metadata, then prefers its same-origin BCIF URL and falls back to CIF.

AlphaFold download URLs returned by metadata are accepted only when their origin is exactly `https://alphafold.ebi.ac.uk`. All remote requests omit credentials. Empty responses, unsupported files, missing entries, network failures, and cancellation are represented by stable `StructureLoadError` codes.

`LoadCoordinator` implements latest-request-wins semantics. Starting another load aborts the previous signal, and a superseded operation cannot publish a late result. The UI and Mol* task manager also maintain generations so cancellation remains effective across network, parsing, and rendering stages.

## Lazy Mol* integration

The empty side panel does not import or initialize Mol*. After the first
explicit load request, `ProtPeekApp` starts structure acquisition and
`LazyStructureViewer.prepare()` together and awaits them with `Promise.all`.
The dynamic `MolstarViewer` import and `PluginContext` initialization therefore
overlap the local read or remote download instead of waiting for it to finish.
No viewer or structure is prefetched before the user request. A successful
viewer is retained for subsequent structures.

`MolstarViewer` implements the small `StructureViewer` contract rather than exposing the standard Mol* application UI. It owns one `PluginContext`, clears its state when replacing a structure, and disposes it when the panel document is unloaded.

The current pipeline:

1. injects already-read text or bytes into Mol*;
2. parses the selected trajectory format;
3. creates a model and its properties;
4. creates the model/asymmetric-unit structure;
5. applies the polymer-and-ligand preset with water hidden;
6. extracts ProtPeek metadata and waits for the first rendered frames.

The viewer supports camera reset, chain visibility, residue and ligand
selection, focus, isolation, overpaint colouring, cartoon/surface polymer
rendering, and highlight/sticks/ball-and-stick selection rendering. The panel
exposes focus, isolate, chain visibility, and selection colours as reversible
controls with `aria-pressed` and visible active states. A second Focus resets
the camera; a second Isolate or **Show all** restores the full structure and
camera. Asynchronous actions report success so the panel can roll back an
optimistic control state after a viewer failure. Mol* interaction events
synchronize residue clicks and hover state with the DOM sequence view.

## Local PDBx/mmCIF download

`MolstarViewer.exportCurrentStructure()` combines the currently visible
components and encodes them as text PDBx/mmCIF with Mol*'s `to_mmCIF` exporter.
Hidden or isolated-away parts are therefore omitted. Export names are
derived from the source identifier or local filename, normalized to a safe
`.cif` filename, and returned through the narrow `StructureExport` contract.

`ProtPeekApp` creates an in-memory `Blob`, starts a browser-native download
through a temporary object URL, and schedules that URL for revocation after
the click. The structure is not uploaded, no backend is involved, and the
extension does not need the WebExtension `downloads` permission.

## High-resolution PNG export

`MolstarViewer.exportCurrentImage()` uses Mol*'s offscreen image pass rather
than enlarging the visible canvas. It preserves the current camera, colours,
visibility, and representations, keeps the viewport aspect ratio, and targets
2560 pixels on the long edge. The dimensions are reduced only when required by
the active GPU's texture or renderbuffer limit. The previous screenshot state
is restored after every export.

The resulting PNG data URL is downloaded through the same browser-native,
temporary-link mechanism as the structure export. The image is rendered and
saved locally and requires neither a backend nor the `downloads` permission.

## Performance decisions

- One Mol* context is reused instead of recreated for each load.
- Post-processing, multisampling, illumination, and Hi-Z are disabled.
- Device-pixel ratio is capped at 1.5 and reduced for larger structures.
- Geometry quality and optional surface resolution adapt to atom count.
- Hydrogens and water are hidden by default.
- Sequences render only the visible horizontal range plus overscan.
- Replaceable network and Mol* tasks can be cancelled.
- Local and remote structure data has a 512 MiB safety ceiling.
- Development timing records stay in memory and are capped at 20 entries.

`npm run benchmark` measures deterministic identifier, scanner, selection-parser, and sequence-mapping CPU paths in Node. It deliberately does not claim to measure browser, WebGL, GPU, or network performance. Established results and the unfilled release-measurement slots are kept in [PERFORMANCE.md](./PERFORMANCE.md).

When development mode is active—or the panel URL contains `?benchmark`—the panel exposes bounded in-memory load records and an animation-frame sampler for the CDP smoke harness. This instrumentation is not transmitted or persisted.

## State and persistence

The background and panel exchange small payloads through `browser.storage.session`, keyed by `windowId`:

- scan payload: detected structures and the source tab ID;
- load payload: one normalized context-menu identifier.

The context-menu payload is removed after consumption. No application database or persistent user profile exists. Loaded molecular data and UI state live in memory and are discarded when replaced or when the panel document is destroyed; normal browser HTTP caching may still apply to remote responses.

## Build and runtime verification

Vitest runs in Node and covers identifiers, contextual scanning, serialization validation, residue parsing/mapping, ligand aggregation, loaders and fallbacks, cancellation/concurrency, performance helpers, and adaptive viewer configuration.

After both WXT builds, `npm run verify:build` reads the generated Chrome and Firefox manifests and fails on drift in:

- Manifest V3 and background declarations;
- exact permissions and official structure-host access;
- strict extension-page CSP;
- icons and toolbar action;
- Chromium `side_panel` versus Firefox `sidebar_action`;
- configured minimum browser versions and Firefox metadata;
- exact HTTP/HTTPS article host declarations and the structure-provider CSP
  network allowlist, with no optional permission declarations;

`scripts/chrome-smoke-client.mjs` connects to an already-open panel through Chrome DevTools Protocol. At a forced `320 × 700` viewport and DPR 2 it verifies that Mol* is absent before a load, then exercises a local CIF fixture, WebGL canvas creation, chain and sequence extraction, residue selection, reversible focus/hide-show/isolate controls, selected-residue representations, surface rendering, colouring, the PDBx/mmCIF download control, and an optional remote replacement. Real Chrome runs have passed for an extended PDB ID and for AlphaFold.

This harness is deliberately separate from the Node unit suite and requires manual Chrome/CDP setup. The final Chrome run passed with SwiftShader, but its 5.7 fps synthetic rotation result is below the intended target and is not representative of hardware-GPU performance. Firefox 154 also passed temporary installation, a real toolbar-action/native-sidebar opening, and local CIF/WebGL2 rendering in the shared extension page; WebDriver's remote-sidebar boundary prevents claiming a complete native-sidebar E2E. Representative hardware-GPU and repeated-load memory measurements remain required before making broader performance claims.

## Store-asset capture

`npm run capture:store` runs `scripts/capture-store-assets.mjs` against a
current Firefox archive. The script temporarily installs the real extension,
loads [PDB 1AON](https://www.rcsb.org/structure/1AON) through its normal RCSB
path, and captures the real UI at exactly 640×400. It then isolates a
molecule-only 512×512 source in Firefox canvas, derives the 128×128 store icon
and manifest icon sizes, and verifies the PNG signatures and dimensions in
Node.

The resulting tracked files live in [`store-assets/`](../store-assets/). They
are real, reproducible browser captures of ProtPeek and Mol*; no generative AI
is used to create them.

## Known architectural limits

- Article detection is contextual and heuristic; candidate existence is checked only during loading.
- Injection targets the main document, not inaccessible or cross-origin frames.
- One structure and the model/asymmetric unit are shown at a time; assembly selection is not implemented.
- Local gzip archives are not decoded.
- Text residue selection does not yet express author insertion codes.
- There is no persistent workspace, comparison mode, or annotation system.
- Browser smoke tests are manual; Chrome's SwiftShader rate is not a hardware-GPU result, and Firefox's WebGL step uses the shared extension document in a tab because WebDriver cannot enter the native remote sidebar. Cross-browser E2E automation, representative GPU timing, and memory-leak automation remain future work.
