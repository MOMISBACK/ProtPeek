# Zotero prototype validation

Version: 0.1.3. Verified on 9 October 2026.

## Automated checks

- TypeScript type checking and ESLint passed.
- All 33 Vitest suites passed: 380 tests, including the improved shared PDB scanner, attachment extraction, all-page PDF scanning, missing files, empty text, pinned-document/race handling, the Zotero menu adapter, and the persistent background preference's narrow bridge, malformed-value handling, and reopen behaviour.
- Chrome and Firefox extension builds and `verify:build` passed.
- `build:zotero` and `verify:zotero` passed. The XPI contains the bootstrap lifecycle hooks, valid Zotero manifest, local HTML and Mol* assets, locales, icons, and license notices; ZIP integrity and window XML were verified.
- No npm dependencies were added.

## Native Zotero integration check (0.1.0)

The packaged XPI was installed using Zotero's actual AddonManager in Zotero **10.0.6 for Linux x86-64**, with a fresh isolated test profile, synthetic references, a seven-page PDF, and the existing `tests/fixtures/minimal.cif` structure. The desktop ran under Xvfb with software rendering. A temporary startup hook launched the test driver; it was not included in the plugin or committed to this repository.

| Check | Result |
| --- | --- |
| Packaged XPI installs and becomes active | Passed |
| Tools menu opens the native ProtPeek window | Passed through the same registered open function |
| Shared Page / Open UI and local-file input load | Passed |
| PDF scan reaches page 7 and detects 1CRN, 1AON, and P0A6F5 | Passed |
| Local mmCIF loads into Mol* and renders a WebGL canvas | Passed |
| Actual Zotero PDF reader contains the ProtPeek toolbar button | Passed |
| Registered selection-popup callback offers Open for 1CRN | Passed |
| Disable closes the viewer and removes menu and reader controls | Passed |
| Re-enable registers one menu without duplicates | Passed |

Native verification exposed two integration issues that are fixed in this package: Firefox privileged windows supply a null `postMessage` source, so the Zotero entry point provides Mol*'s supported timer-based scheduler; and initial `about:blank` navigation must not release window/control tracking before the real document loads. Lifecycle tracking now checks the relevant document and removes its listeners on shutdown.

## Native menu and upgrade check (0.1.1)

The 0.1.1 XPI was tested in the same Zotero 10.0.6 Linux runtime with isolated profiles and the local mmCIF fixture. Pointer input used the desktop window's mouse-event API, rather than calling the menu handlers directly. The upgrade test first installed the exact published 0.1.0 release package and opened its viewer, then installed 0.1.1 through AddonManager.

| Check | Result |
| --- | --- |
| Install 0.1.1 over the published 0.1.0 package | Passed; addon active at version 0.1.1 |
| Upgrade closes the old viewer and loads the new controls | Passed |
| Cartoon / Surface representation changes | Passed |
| Chain / Uniform / Residue type colour changes | Passed |
| Selected-residue Sticks / Ball & stick changes | Passed |
| Selection styles disabled without a selection | Passed |
| Isolation disables global menus; Show all restores them | Passed |
| Outside pointer closes a menu | Passed |
| Menus remain usable in a 380-pixel-wide viewer | Passed; layout inspected |
| Viewer operations finish without JavaScript errors | Passed |
| Disable closes the viewer and disposes its controls | Passed |

Zotero's native select popups were unreliable in the privileged viewer iframe. Version 0.1.1 replaces those popups with HTML controls in Zotero while preserving the shared selects and their existing change handlers.

## Native toolbar check (0.1.2)

The 0.1.2 XPI was installed in a fresh isolated Zotero 10.0.6 Linux profile. After rendering the local mmCIF fixture, the structure-download and PNG-capture buttons were absent from the viewer DOM. Reset view remained visible and enabled, and completed successfully through pointer input. Representation, colour, selection, isolation/restoration, narrow-window, and disable-cleanup checks also passed without JavaScript errors.

## Native viewer and preference check (0.1.3)

The 0.1.3 XPI was tested in Zotero **10.0.6 Linux x86-64**, using an isolated
profile, a synthetic local HTML attachment, and the local structure fixtures.
All **59 checks passed**: 51 installation/upgrade/viewer checks and eight checks
after restarting the same Zotero profile. Test instrumentation stayed outside
the repository and plugin package.

| Check | Result |
| --- | --- |
| AddonManager installs 0.1.3 over 0.1.2 and closes the old viewer | Passed |
| Improved PDB wording and links in a local HTML attachment | Six expected identifiers detected |
| Local structure loads and renders in Mol* | Passed |
| White / Black choices change the actual WebGL canvas | Corner pixels verified as RGB 255/255/255 and 0/0/0 |
| Reset and structure replacement preserve the background | Passed |
| Closing/reopening the viewer preserves the background | Passed |
| Restarting Zotero preserves the background | Passed in the same profile |
| Interface switches between light/dark while the canvas stays black | Passed; interface pixels changed |
| Menus and background controls at 380 and 300 px | Passed without horizontal document overflow |
| Structure-download and PNG-capture buttons remain absent | Passed |
| Disable removes the viewer, Tools menu, and plugin API | Passed |

The background uses only `extensions.protpeek.viewerBackground` in local Zotero
preferences. Unit tests also cover unset/malformed values and repair of a
manually changed preference type. No new PDF-processing or automatic
residue/mutation-detection feature is included.

## Remaining verification boundaries

- Windows, macOS, and Zotero 7, 8, and 9 have not been run here. The manifest targets their desktop APIs; that is not a platform test result.
- Native testing used a local structure. Remote RCSB/AlphaFold loads retain the existing browser loaders and their tests; a live provider download was not exercised in this native test.
- Full text-selection interaction and native file-open dialogs were not automated.
- OCR, EPUB, and password-protected PDF extraction are not verified features. Missing local files and empty extractable text have explicit fallback messages.

This is an installable prototype, with the above limits recorded for review.
