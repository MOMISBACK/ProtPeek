# ProtPeek browser extensions 0.1.3

- Improved PDB identifier detection in accession-number wording, suffix labels,
  annotated lists, lists with an Oxford comma, and official structure links/DOIs.
- Added White / Black background choices in Customize view. The choice is saved
  on the device and is independent of the interface's light or dark theme.
- Harmonized typography, text contrast, colours, and controls across the browser
  panel and website.

Article processing remains local. No additional network permissions or services
are introduced. This release adds no browser PDF processing or automatic residue
or mutation detection.

## Store submission

- Chrome Web Store: `ProtPeek-0.1.3-chrome.zip`.
- Firefox Add-ons: `ProtPeek-0.1.3-firefox.zip`.
- Firefox reviewer sources: `ProtPeek-0.1.3-sources.zip`.

Rebuild with Node.js 24 and npm: run `npm ci`, then `npm run zip:firefox` or
`npm run zip:chrome`. Mol* and all executable extension code are bundled locally.
