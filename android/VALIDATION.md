# Android prototype 0.1.0 validation

Tested source: `1e4ed48e180a57c645bff042c2349f9c4b7d3888`.
[Successful Android workflow](https://github.com/MOMISBACK/ProtPeek/actions/runs/44912620802).

- TypeScript checking, ESLint, and 485 JavaScript tests in 44 suites pass.
- Android release lint and Java compilation pass for both release packages and
  the debug/instrumentation APKs.
- The built mobile UI passes 32 Chromium checks with real Mol* rendering:
  light/dark layouts, selection, rotation, expansion, exact protein/publication
  filtering and actual PNG/mmCIF export bytes. API responses and native document
  transport are simulated in these web checks.
- A debug build passes real Android API 35 WebView instrumentation: trusted
  bundled origin, restricted file/content settings, native content-URI imports
  at launch and through onNewIntent, sequence metadata, and rotation preserving
  the document and WebView. The fixture is a synthetic eight-residue trace and Mg.
- Native images in portrait and landscape show geometry, colors and camera axes.
  Central image crops exclude shell controls and axes; all must contain opaque
  molecular pixels. The real Mol* PNG export is also decoded and checked. Only
  its native save-dialog transport is intercepted by instrumentation.

| Native check | Opaque foreground samples |
| --- | ---: |
| Initial import | 2205 |
| Second import | 2227 |
| Landscape | 511 |
| After PNG export | 511 |
| Exported molecular PNG | 436 |

The CI uses the supported `swangle` emulator backend. The former
`swiftshader_indirect` backend produced transparent geometry with the same
application; changing only the emulator backend restored opaque colors and
visible geometry. No application workaround was added for that legacy driver.

Release APK/AAB signatures, public-certificate fingerprint, embedded package
identity/version, sizes and SHA-256 hashes are verified separately. Original
unsigned ZIP-entry payloads remain unchanged after signing. The signed AAB also
passes official bundletool validation. `releases/release.json` records source
and artifact provenance; publication checks all three source-workflow jobs.
The signing key is not committed to Git or available to CI.

No physical Android device has been tested. Native save/share dialogs have not
been automated end to end. Public-provider availability can vary. Live search
checks resolved cnoX/P77395 and the Cell DOI 10.1016/j.cell.2023.01.013
(PMID 36764293) to its primary-associated structure 7YWY.

Zotero 0.1.10 has shared-UI, export-adapter and package checks with mocked host
APIs. Its real native dialogs and GUI remain untested in this environment;
see `zotero/VALIDATION.md`.
