# ProtPeek browser extensions 0.1.6

- Fix the **RESIDUES** label overlapping the input field in narrow side panels.
  The editor now reserves the actual label width and places selection controls
  on separate rows when there is not enough horizontal space.
- Associate the visible label with its input for mouse and assistive technology.
- Add Chromium-rendered regression checks for actual label text bounds at
  narrow and wide panel sizes, in dark and light themes.
- No changes to protein selection semantics, extension permissions or remote endpoints.

## Packages

- Chrome: `ProtPeek-0.1.6-chrome.zip`
- Firefox: `ProtPeek-0.1.6-firefox.zip`
- Firefox reviewer sources: `ProtPeek-0.1.6-sources.zip`

Store publication is separate from these GitHub release packages.

---

## Version 0.1.5

- Selecting a residue in the protein sequence now fills the editable **Residues** field
  immediately and applies the selection to the 3D structure.
- Ctrl/Cmd-click toggles additional sequence residues; Shift-click selects a contiguous
  sequence interval. Multiple selected residues stay highlighted in the virtualized sequence.
- Manual residue expressions apply on **Select** or Enter; invalid expressions leave the
  previous committed selection untouched.
- Clicking a residue in the 3D viewer updates the same input and switches the displayed
  chain when needed.
- Author residue numbers and PDB insertion-code suffixes are handled separately
  (for example `A:11` versus `A:11A`). Compact ranges never silently add
  unselected insertion-coded residues.
- Remove the redundant selection caption next to Focus / Isolate. Retain the
  responsive panel and subtle White/Black background controls from 0.1.4.

No added permissions or remote services. Local structure files remain on the device.

## Packages

- Chrome: `ProtPeek-0.1.5-chrome.zip`
- Firefox: `ProtPeek-0.1.5-firefox.zip`
- Firefox reviewer sources: `ProtPeek-0.1.5-sources.zip`

These are source-build packages; publishing to the Chrome/Firefox stores remains
a separate store-review process. Build with Node 24 and `npm ci`.
