# Zotero prototype validation

Version: 0.1.0. Verified on 8 October 2026.

## Automated checks

- TypeScript type checking and ESLint passed.
- All 30 Vitest suites passed: 308 tests, including attachment extraction, all-page PDF scanning, missing files, empty text, and pinned-document/race handling in the Zotero bridge.
- Chrome and Firefox extension builds and `verify:build` passed.
- `build:zotero` and `verify:zotero` passed. The XPI contains the bootstrap lifecycle hooks, valid Zotero manifest, local HTML and Mol* assets, locales, icons, and license notices; ZIP integrity and window XML were verified.
- No npm dependencies were added.

## Native Zotero check

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

## Remaining verification boundaries

- Windows, macOS, and Zotero 7, 8, and 9 have not been run here. The manifest targets their desktop APIs; that is not a platform test result.
- Native testing used a local structure. Remote RCSB/AlphaFold loads retain the existing browser loaders and their tests; a live provider download was not exercised in this native test.
- Full text-selection interaction and native save/export dialogs were not automated.
- OCR, EPUB, and password-protected PDF extraction are not verified features. Missing local files and empty extractable text have explicit fallback messages.

This is an installable first prototype, with the above limits recorded for review.
