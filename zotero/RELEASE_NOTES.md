# ProtPeek for Zotero 0.1.6

Released on 15 October 2026.

- Prevent the **RESIDUES** label from being obscured by its text input in
  narrow ProtPeek windows. The shared responsive editor uses an intrinsic-width
  label column and moves secondary controls beneath the field.
- Link the visible label to the input for improved accessibility.
- Keep 0.1.5 sequence and 3D selection behaviour unchanged.

Install `protpeek-zotero-0.1.6.xpi` with **Tools → Plugins → Install Plugin
From File…**. Close and reopen the ProtPeek window after upgrading.

The shared UI and packaging run through automated CI; native Zotero GUI
testing for 0.1.6 has not been performed.

---

## ProtPeek for Zotero 0.1.5

Released on 15 October 2026.

- Synchronize clicks in the protein sequence with the editable **Residues**
  input and Mol* selection.
- Ctrl/Cmd-click toggles residues, Shift-click selects a range, and multiple
  selected residues remain visible in the sequence.
- Typed residue selections apply only when explicitly confirmed with Select
  or Enter. Invalid drafts no longer replace a valid selection.
- Show 3D-picked residue identifiers in the same input; handle author residue
  numbers and insertion-code suffixes without conflating distinct residues.
- Remove the redundant selection caption while retaining the responsive
  inspector and the less prominent White/Black controls.

Download `protpeek-zotero-0.1.5.xpi` and install it using **Tools → Plugins →
Install Plugin From File…**. Close and reopen the viewer after updating.

The shared automated tests validate the UI logic and generated Zotero package.
Native Zotero 0.1.5 behavior has not been separately exercised; see
[validation limits](./VALIDATION.md).

## 0.1.4

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

Download `protpeek-zotero-0.1.2.xpi` through Zotero's plugin installer.

## 0.1.1

Released on 8 October 2026.

- Replace unreliable native select menus with accessible HTML popup controls.
- Add keyboard navigation, menu cleanup and disabled-state synchronization.

## 0.1.0

Initial installable Zotero prototype: local PDF/HTML scanning, identifiers,
Mol* structure inspection and explicit local or remote structure loading.
