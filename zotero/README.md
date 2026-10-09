# ProtPeek for Zotero

A desktop Zotero plugin built from the same identifier scanner, loaders, UI, and Mol* viewer as the ProtPeek browser extension. Current prototype: version 0.1.4.

## Installation

1. Download [protpeek-zotero-0.1.4.xpi](https://github.com/MOMISBACK/ProtPeek/releases/download/zotero-v0.1.4/protpeek-zotero-0.1.4.xpi) from the [Zotero 0.1.4 release](https://github.com/MOMISBACK/ProtPeek/releases/tag/zotero-v0.1.4). In Firefox, **right-click → Save Link As…** to download the file rather than trying to install it as a Firefox extension. The download is already an `.xpi`; do not unzip it.
2. In Zotero, open **Tools → Plugins**.
3. Drag the `.xpi` into the Plugins window, or use **Install Plugin From File…** in its settings menu.
4. Open a PDF and click **ProtPeek** in the reader toolbar. Alternatively, select a paper and use **Tools → ProtPeek — Protein structures** or the **ProtPeek** section of the item pane.

To replace an older version, install the new XPI through the same Plugins window. Close the old ProtPeek viewer before reopening it.

The manifest targets the desktop Zotero 7–10 plugin APIs. The package is intended for Windows, macOS, and Linux; native-platform verification and any remaining limitations are recorded in [VALIDATION.md](./VALIDATION.md). It does not extend Zotero's website or mobile apps.

For development builds, each successful [CI run](https://github.com/MOMISBACK/ProtPeek/actions/workflows/ci.yml) also provides a `protpeek-zotero` artifact. GitHub requires sign-in to download that ZIP; unzip it to obtain the `.xpi`.

## Usage

- **Page:** scan the selected paper's local PDF or HTML attachment for contextual PDB, UniProt, and AlphaFold identifiers. PDFs are scanned in full, including pages beyond Zotero's full-text index limit.
- Click a detected identifier to download and display its structure. Selecting an exact identifier in the PDF also offers an **Open … in ProtPeek** action.
- **Open:** enter a PDB, UniProt, or AlphaFold identifier, or load a local `.pdb`, `.cif`, `.mmcif`, `.bcif`, or `.gro` file.
- The chain, sequence, residue, ligand, representation, colour, focus, and Reset view tools are available. Structure download and PNG capture buttons are omitted from the Zotero viewer.
- **Customize view → Background:** choose White or Black independently of the interface theme. The choice is saved locally in Zotero preferences and retained after changing structures, resetting the view, closing the viewer, or restarting Zotero.
- The structure-display menus support pointer clicks and keyboard selection: arrows navigate, Enter selects, and Escape closes a menu. Selected-residue styles become available after a chain, ligand, or residue selection; global display menus are disabled while a selection is isolated.

The viewer opens in a non-modal window so the PDF remains visible. The document name at the top identifies the scanned attachment. Each viewer is pinned to that document; to switch papers, open ProtPeek from the other paper. The refresh button rescans the pinned document.

For GRO coordinate files, ProtPeek displays the first frame and converts
nanometres to ångströms through Mol*. Chain identifiers and bonds are inferred;
trajectory playback, velocities, explicit topology, and triclinic box geometry
are not displayed.

## Privacy and boundaries

- No account, API key, analytics, or ProtPeek backend.
- Document text, library metadata, and local structures stay on the computer.
- Only the viewer background choice is saved in a namespaced local Zotero preference; it contains no article text or structure history.
- Scanning does not send identifiers to a structure service. A remote request occurs only after an explicit Open action.
- Requests are limited to the existing RCSB PDB and AlphaFold DB origins. Executable viewer code, including Mol*, is bundled locally.
- The integration does not create, edit, or delete Zotero references, notes, annotations, or files. It does not use Zotero's Web API.
- Zotero requires an update URL in the plugin manifest and may check GitHub for plugin-update metadata. No document content is included in these checks. This prototype's update feed is empty; install updates manually from the release downloads.
- Zotero's own synchronization and networking are independent of this plugin.

Missing attachments must first be downloaded using Zotero. Image-only PDFs require OCR performed separately; ProtPeek does not include OCR. Password-protected PDFs may require manual identifier entry. EPUB scanning is outside this prototype. Detection is contextual and cannot guarantee that every structure mentioned in an article will be found.

## Build

Use Node.js 24, npm, and Python 3 (standard library only for ZIP packaging):

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:zotero
npm run verify:zotero
```

Output: `release/protpeek-zotero-0.1.4.xpi`. The unpacked package is in `.output/zotero/`. No new npm dependencies were added.

The build aliases `wxt/browser` to a Zotero adapter for the shared UI. Session communication stays in memory; the background choice uses a narrow preference getter/setter. The plugin exposes attachment scanning and this display preference instead of passing the Zotero object into the viewer. Lifecycle cleanup removes controls, unregisters reader hooks and the item-pane section, and closes viewer windows when disabled.

The Zotero entry point also provides a timer-based `setImmediate` implementation before loading Mol*. This avoids Firefox's privileged-window `postMessage` source restriction while keeping the browser-extension build unchanged.

## Publishing a Zotero release

Update `zotero/manifest.json`, the download links, and [RELEASE_NOTES.md](./RELEASE_NOTES.md) for the new version, then merge the changes into `main`. Push a tag named `zotero-v<version>` at that commit. For version 0.1.4:

```sh
git tag zotero-v0.1.4
git push origin zotero-v0.1.4
```

Alternatively, include `[release-zotero]` in the commit or merge message on `main`. CI then creates the matching release tag at that validated commit.

CI runs its checks and both browser builds, builds and verifies the Zotero package, and publishes that exact artifact as a GitHub prerelease. Publication fails if a supplied tag, source manifest, or packaged manifest versions differ. Ordinary branch pushes and pull requests only produce development artifacts.

Zotero uses its own `zotero-v…` tags independently of browser release versions. The plugin-update feed remains manual for this prototype.

Reference documentation: [Zotero plugin development](https://www.zotero.org/support/dev/client_coding/plugin_development), [reader and item-pane APIs](https://www.zotero.org/support/dev/zotero_7_for_developers), and [Zotero 10 developer changes](https://www.zotero.org/support/dev/zotero_10_for_developers).
