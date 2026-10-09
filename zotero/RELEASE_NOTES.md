# ProtPeek for Zotero 0.1.4

Released on 9 October 2026.

- Open local GROMACS `.gro` coordinate files through the Open tab or drag and drop.
- Use Mol*'s bundled GRO reader, including conversion of nanometres to ångströms.
- Display the first frame of a concatenated GRO file, with inferred chain IDs and
  bonds. Trajectory playback, velocities, explicit topology, and triclinic box
  geometry are outside this viewer's GRO support.

Download `protpeek-zotero-0.1.4.xpi` and install it through **Tools → Plugins →
Install Plugin From File…**. Close and reopen the ProtPeek viewer after updating.
See [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.4/zotero/VALIDATION.md)
for checks and platform limits.

## 0.1.3

Released on 9 October 2026.

- Improve PDB detection for accession-number wording, suffix labels, annotated
  lists, Oxford commas, and official structure URLs/DOIs.
- Harmonize the viewer's typography, controls, and light/dark colours with the
  browser extensions, including stronger small-text contrast.
- Add White / Black background choices in Customize view, independent of the
  interface theme. The choice is saved locally in Zotero preferences and survives
  viewer reopening and Zotero restarts.
- Keep structure-download and PNG-capture buttons omitted from Zotero.

Download `protpeek-zotero-0.1.3.xpi` and install it through **Tools → Plugins →
Install Plugin From File…**. Close and reopen the ProtPeek viewer after updating.
No new PDF-processing or automatic residue/mutation-detection feature is added.
See [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.3/zotero/VALIDATION.md)
for checks and platform limits.

## 0.1.2

Released on 8 October 2026.

- Remove the structure-download and PNG-capture buttons from the Zotero viewer toolbar.
- Keep Reset view and the structure-inspection controls available.

Download `protpeek-zotero-0.1.2.xpi` and install it through **Tools → Plugins → Install Plugin From File…**. Close and reopen the ProtPeek viewer after updating. See [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.2/zotero/VALIDATION.md) for checks and platform limits.

## 0.1.1

Released on 8 October 2026.

- Fix the representation, colour, and selected-residue menus in Zotero's viewer window. The Zotero integration now uses HTML popup controls rather than platform-native select popups.
- Keep menu values synchronized with the visualizer, including rejected operations and programmatic resets. Disabled controls follow selection and isolation state.
- Support keyboard selection and closing with Escape, Tab, or an outside click. Remove menu listeners and observers when the viewer closes.
- Document saving the XPI from Firefox and replacing an installed 0.1.0 plugin.

Download `protpeek-zotero-0.1.1.xpi` and install it through **Tools → Plugins → Install Plugin From File…**. Close and reopen the ProtPeek viewer after updating. The plugin remains a prototype; see [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.1/zotero/VALIDATION.md) for checks and platform limits.

## 0.1.0

First installable desktop prototype, released on 8 October 2026.

- Scan a paper's local PDF or HTML attachment for contextual PDB, UniProt, and AlphaFold identifiers. PDF scanning covers all pages.
- Open ProtPeek from the PDF reader toolbar, a selected identifier, the item pane, or the Tools menu.
- Inspect structures with the existing Mol* viewer, including chains, sequences, residues, ligands, representations, colours, focus, and export controls.
- Open local PDB and mmCIF files, or explicitly request a remote structure from RCSB PDB or AlphaFold DB.
- Keep document scanning and local-file processing on the computer. The plugin does not edit Zotero references, annotations, or attachments.

Install `protpeek-zotero-0.1.0.xpi` through Zotero's **Tools → Plugins → Install Plugin From File…** menu. The XPI is the plugin package; do not unzip it. Updates are manual for this prototype.

The manifest targets Zotero 7–10. Native testing used Zotero 10.0.6 on Linux; macOS, Windows, and older Zotero versions remain unverified. OCR, EPUB scanning, and password-protected PDF extraction are outside the verified features. See [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.0/zotero/VALIDATION.md) for the automated and native checks and their limits.
