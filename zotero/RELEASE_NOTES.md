# ProtPeek for Zotero 0.1.0

First installable desktop prototype, released on 8 October 2026.

- Scan a paper's local PDF or HTML attachment for contextual PDB, UniProt, and AlphaFold identifiers. PDF scanning covers all pages.
- Open ProtPeek from the PDF reader toolbar, a selected identifier, the item pane, or the Tools menu.
- Inspect structures with the existing Mol* viewer, including chains, sequences, residues, ligands, representations, colours, focus, and export controls.
- Open local PDB and mmCIF files, or explicitly request a remote structure from RCSB PDB or AlphaFold DB.
- Keep document scanning and local-file processing on the computer. The plugin does not edit Zotero references, annotations, or attachments.

Install `protpeek-zotero-0.1.0.xpi` through Zotero's **Tools → Plugins → Install Plugin From File…** menu. The XPI is the plugin package; do not unzip it. Updates are manual for this prototype.

The manifest targets Zotero 7–10. Native testing used Zotero 10.0.6 on Linux; macOS, Windows, and older Zotero versions remain unverified. OCR, EPUB scanning, and password-protected PDF extraction are outside the verified features. See [the validation report](https://github.com/MOMISBACK/ProtPeek/blob/zotero-v0.1.0/zotero/VALIDATION.md) for the automated and native checks and their limits.
