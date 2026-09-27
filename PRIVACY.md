# ProtPeek privacy policy

Last updated: 27 September 2026
Applies to: ProtPeek `0.1.2` as represented by this repository

Public policy URL: <https://momisback.github.io/ProtPeek/privacy/>

## Summary

ProtPeek does not operate a backend service and does not include analytics, advertising, tracking pixels, telemetry, user accounts, or profiling. It does not sell personal data.

ProtPeek's engine and 100% of its executable code run locally in the browser.
Every JavaScript module, including Mol*, is packaged with the extension; no
executable code is downloaded at runtime. Article analysis, local-file parsing,
molecular processing, rendering, and interaction remain on the user's device.

ProtPeek contacts only the official RCSB or AlphaFold structure services, and
only after the user explicitly requests a remote identifier. Those requests
download structure data, not executable code. See
[TRANSPARENCY.md](./TRANSPARENCY.md) for the complete local/remote boundary.

## Data handled by ProtPeek

### Article scanning

ProtPeek has access to HTTP and HTTPS pages so detection can follow the active
tab while the panel is open. When the panel opens, the active tab changes,
navigation completes, article content changes, or the user presses the rescan
button, ProtPeek reads a bounded snapshot of the main document's visible text,
links, metadata, page URL, and JSON-LD to find contextual PDB, UniProt, and
AlphaFold references. A debounced monitor sends only a page-changed signal so
the live panel can request another scan; it does not send DOM mutations or page
content.

This snapshot is processed locally inside the injected extension script. The full page snapshot is not sent to ProtPeek, RCSB, AlphaFold, or any other server. Only compact detections—identifier, database type, display form, format, and detection-source labels—are returned to the extension background.

### Context-menu selection

When the user selects text and invokes **View in ProtPeek**, the selection is parsed locally. If it contains a supported structural identifier, only the normalized identifier is passed to the panel. Arbitrary surrounding selection text is not uploaded.

### Local structure files

Files dropped into ProtPeek are read with browser file APIs and parsed locally by Mol*. They are not uploaded. ProtPeek does not create a cloud copy or a persistent application copy of the file.

### Local PDBx/mmCIF download

The user can download the currently visible structure as a PDBx/mmCIF `.cif`
file. Mol* serializes the visible components locally, so hidden or
isolated-away parts are omitted. ProtPeek passes the result as an in-memory
`Blob` to a temporary browser object URL. No structure data is sent to ProtPeek
or another service for this conversion. The browser saves the resulting file
to the user's configured download location; ProtPeek then revokes the
temporary URL and keeps no additional export copy.

### Local PNG image download

The user can save the currently displayed, customized molecular view as a
high-resolution PNG. Mol* renders that image locally, and ProtPeek passes it to
the browser through a temporary download link. No image, structure, camera
state, or customization is uploaded or retained by ProtPeek.

### Remote structure identifiers and downloads

Loading a remote structure necessarily sends the selected identifier to an official third-party provider:

| User action | Service contacted | Data sent |
| --- | --- | --- |
| Load a PDB ID | `models.rcsb.org` | PDB identifier in a BinaryCIF request path |
| PDB fallback | `files.rcsb.org` | PDB identifier in an mmCIF request path |
| Load a UniProt or AlphaFold ID | `alphafold.ebi.ac.uk` | UniProt accession in the metadata request path, followed by an official structure-file request |

ProtPeek sends these requests without extension-supplied credentials. As with any web request, the provider and network intermediaries may receive standard technical information such as IP address, request time, user agent, and transport headers. Their handling and retention are governed by their own policies, not by ProtPeek.

ProtPeek accepts AlphaFold download links from metadata only when the origin remains exactly `https://alphafold.ebi.ac.uk`.

## Storage and retention

ProtPeek uses `browser.storage.session` to coordinate its background and side-panel documents per browser window. It stores only:

- detected structure identifiers and the source tab ID;
- a normalized identifier awaiting a context-menu load;
- an optional page-scan error message.

The context-menu load value is removed after the panel consumes it. Scan results are overwritten or cleared as the active tab changes. Session storage is browser-managed and is not used by ProtPeek as durable storage across browser sessions.

Downloaded structures, local-file contents, selections, and viewer state remain in memory while needed. They are discarded when replaced or when the panel document is destroyed. ProtPeek adds no application cache, although the browser's normal HTTP cache may retain remote responses according to standard browser and server rules.

A PDBx/mmCIF file explicitly saved by the user remains in the browser's chosen
download location under the user's control. It is not part of ProtPeek's
session storage.

Development builds can retain up to 20 in-memory performance records and print diagnostic warnings to the developer console. These records are not transmitted. Production logging is disabled by the current implementation.

## Build and release directories

Local development and production builds are generated under the hidden
`.output/` working directory. It is ignored by Git, contains unpacked browser
extension builds and archives, and can be recreated from source. The
`npm run release` pipeline verifies those builds and copies the browser and
source archives into the visible [`release/`](./release/) directory for
inspection. Generated ZIP files are not tracked in Git, and official archives
are attached to the matching GitHub Release. These packaging locations do not
change ProtPeek's data flow or introduce remote execution.

## Published store assets

The repository's [640×400 store screenshot](./store-assets/protpeek-640x400.png)
and [128×128 icon](./store-assets/protpeek-icon-128.png) were captured from the
real extension rendering the public experimental structure
[PDB 1AON](https://www.rcsb.org/structure/1AON). They contain no article text,
local user file, identifier history, or other user data. No generative AI was
used to create them. Maintainers can reproduce and dimension-check them with
`npm run capture:store` after building a Firefox archive.

## Permission explanation

| Permission or host access | Why it is required |
| --- | --- |
| HTTP and HTTPS page access | Allows bounded local article scans while the panel is open |
| `scripting` | Injects the bounded scanner and local page-change monitor into the active tab |
| `contextMenus` | Adds **View in ProtPeek** for an explicitly selected identifier |
| `storage` | Uses session-scoped payloads so the MV3 background and panel can communicate reliably |
| `sidePanel` (Chromium, generated by WXT) | Displays the shared ProtPeek panel |
| CSP network allowlist | Restricts extension-initiated connections to the official RCSB and AlphaFold hosts |

ProtPeek does not request access to local files or browser-internal pages,
browsing history, the `tabs` permission, cookies, the WebExtension `downloads`
permission, geolocation, camera, microphone, or identity permissions. Saving a
locally generated PDBx/mmCIF file uses a standard temporary browser link
instead.

Firefox's manifest declares the data category `searchTerms`. In ProtPeek this refers to user-entered or user-selected PDB/UniProt/AlphaFold identifiers sent to the relevant structure provider to fulfil the requested lookup. It does not represent analytics collection or transmission to a ProtPeek-operated service.

## Sharing and sale

ProtPeek does not sell, rent, or use data for advertising. The only disclosure caused by the extension is the provider request necessary to retrieve a user-requested remote structure, as described above.

Browser vendors, extension stores, operating systems, networks, and the official structure providers operate independently and may process technical data under their own policies.

## User control

Users can avoid all remote requests by loading only local files. They can cancel an in-progress load, replace the current structure, close the panel, disable the extension, or uninstall it through the browser.

Because ProtPeek has no account system or ProtPeek-operated server, there is no server-side ProtPeek profile to access or delete.

## Changes and contact

This policy should be updated whenever ProtPeek's permissions, providers, storage, or telemetry behaviour changes. Privacy questions should be directed to the support channel shown on the browser-store listing from which ProtPeek was installed.

ProtPeek is distributed under the
[Mozilla Public License 2.0](./LICENSE), with separate terms for the reserved
name and brand assets in [TRADEMARKS.md](./TRADEMARKS.md). Contributions are
open under [CONTRIBUTING.md](./CONTRIBUTING.md), but no contribution is merged
without explicit approval from **MOMISBACK**.
