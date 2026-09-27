<!-- SPDX-License-Identifier: MPL-2.0 -->
# ProtPeek store assets

These PNGs are reproducible real-Firefox captures, not mock-ups or generative
AI artwork. The structure is the experimental GroEL–GroES–(ADP)7 complex
[PDB 1AON](https://www.rcsb.org/structure/1AON), fetched from RCSB and rendered
locally by ProtPeek's pinned Mol* build in Firefox.

Regenerate them from a current Firefox archive with:

```sh
npm run zip:firefox
npm run capture:store
```

The script temporarily installs the Firefox release archive, loads `1AON`
through the real extension UI, validates the short-height layout and the
Focus/Isolate round trip, and captures `protpeek-640x400.png` at exactly
640×400. It then excludes Mol*'s orientation helper from an adaptive,
molecule-only square crop, derives `protpeek-icon-128.png` and the browser icon
sizes with Firefox's canvas, and checks every PNG signature and exact
dimensions in Node. Set
`PROTPEEK_FIREFOX_BINARY` or `PROTPEEK_GECKODRIVER` when those executables are
not in their usual locations.
