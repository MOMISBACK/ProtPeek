# ProtPeek browser extensions 0.1.4

- Open local GROMACS `.gro` coordinate files from the Open tab or by drag and drop.
- Use the bundled Mol* GRO reader, with coordinates converted from nanometres to
  ångströms and chain identifiers and bonds inferred from the coordinate file.
- Keep mmCIF export available for the loaded GRO structure.

A concatenated GRO file opens its first frame. This release does not add
trajectory playback, velocity display, explicit topology, or triclinic box
reconstruction. Local files stay on the device; no dependencies or permissions
are added.

## Store submission

- Chrome Web Store: `ProtPeek-0.1.4-chrome.zip`.
- Firefox Add-ons: `ProtPeek-0.1.4-firefox.zip`.
- Firefox reviewer sources: `ProtPeek-0.1.4-sources.zip`.

Rebuild with Node.js 24 and npm: run `npm ci`, then `npm run zip:firefox` or
`npm run zip:chrome`. Mol* and all executable extension code are bundled locally.
