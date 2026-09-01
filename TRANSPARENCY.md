# ProtPeek transparency

ProtPeek's parsing, article analysis, molecular rendering, selections, and
viewer state execute on the user's device. Every executable JavaScript module
is packaged with the extension. ProtPeek downloads no executable code at
runtime and operates no processing backend.

“Local-first” does not mean that every workflow is offline. Loading a remote
identifier requires downloading structure data from an official provider,
only after an explicit user action.

## What remains local

- local CIF, mmCIF, BinaryCIF, and PDB file contents;
- article text, links, metadata, and JSON-LD inspected by each bounded scan;
- Mol* parsing, structure construction, rendering, selections, and colours;
- PDBx/mmCIF generation and the temporary object URL used to download the currently visible structure;
- sequences, chain and ligand metadata, active viewer state, and benchmarks.

Local files are never uploaded. The article snapshot is processed inside the
injected extension script; only compact structure detections return to the
extension background. A debounced page monitor sends only a changed signal so
the live panel can request another scan; it does not send DOM mutations or page
text. Focus, isolation, chain visibility, selected-residue rendering,
and selection colours are local viewer state. Their pressed/active indicators
are maintained in the panel and reversible actions are sent directly to the
packaged Mol* viewer.

The download button serializes the currently visible structure to text
PDBx/mmCIF in the browser, creates a temporary in-memory object URL, and asks
the browser to save the resulting `.cif` file. Hidden or isolated-away parts
are omitted. This action neither uploads the structure nor contacts a ProtPeek
service.

## Network requests

ProtPeek has no first-party API. Its application code makes remote requests
only to these official structure services:

| Host | Trigger | Purpose |
| --- | --- | --- |
| `models.rcsb.org` | Explicit PDB load | BinaryCIF structure |
| `files.rcsb.org` | BinaryCIF fallback | mmCIF structure |
| `alphafold.ebi.ac.uk` | Explicit UniProt/AlphaFold load | Prediction metadata and structure |

Requests omit extension-supplied credentials. AlphaFold download URLs are
accepted only when their origin remains exactly `https://alphafold.ebi.ac.uk`.
There is no telemetry, analytics, advertising, account service, tracking
endpoint, or remote script execution.

## Permissions

- `activeTab`: temporary page access after a user gesture;
- `scripting`: injection of the bounded scanner and local page-change monitor;
- `contextMenus`: explicit identifier selection workflow;
- `storage`: session-only coordination between the MV3 background and panel;
- HTTP(S) page access: automatic scans of the active tab while the panel is open;
- exact RCSB and AlphaFold hosts listed above for structure downloads;
- Chromium's generated `sidePanel` permission.

The manifest spells page access as explicit `http://*/*` and `https://*/*`
patterns rather than `<all_urls>`. ProtPeek does not request browsing history,
cookies, identity, downloads, geolocation, camera, or microphone permissions.

Saving the locally generated PDBx/mmCIF file uses a standard temporary link;
it does not use or require the WebExtension `downloads` permission.

While the panel is open, activation, completed-load, in-page navigation, and
debounced document-change events request a fresh scan only for the active tab
in the same browser window. Closing the panel removes its listeners, so page
change signals no longer trigger scans. The toolbar and manual refresh control
also request an immediate scan.

## Storage

`browser.storage.session` contains only compact article detections, a source
tab identifier, an identifier awaiting a context-menu load, or a scan error.
Structures and local files are not placed in ProtPeek application or session
storage. A PDBx/mmCIF export explicitly requested by the user remains in the
browser-managed download location under the user's control. The browser's
normal HTTP cache may also cache provider responses.

## Auditing and reproducibility

The complete source, locked dependency graph, manifest configuration, build
verifier, tests, and release procedure are public. To rebuild and inspect both
targets:

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build:firefox
npm run build:chrome
npm run verify:build
```

The published [640×400 store screenshot](./store-assets/protpeek-640x400.png)
and [128×128 store icon](./store-assets/protpeek-icon-128.png) are real Firefox
captures of ProtPeek rendering the public experimental structure
[PDB 1AON](https://www.rcsb.org/structure/1AON). They contain no user content,
and no generative AI was used to create them. After producing a Firefox archive,
`npm run capture:store` repeats the real-extension capture and verifies the PNG
signatures and exact dimensions.

Any contribution adding a host, permission, transmission, persistent store,
telemetry, or remote processing must be discussed first and update this file,
`PRIVACY.md`, tests, and the generated-manifest verifier. It is not accepted
without explicit maintainer approval.
