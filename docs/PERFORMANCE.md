# ProtPeek performance record

This file separates measurements that have actually been observed from release metrics that are still missing. Results are diagnostic, environment-specific, and must not be generalized beyond their stated method.

## Design choices already implemented

- Mol* is dynamically imported only when the first structure is requested.
- One `PluginContext` is reused across replacement loads.
- Superseded network, parsing, rendering, and viewer actions are cancelled or prevented from publishing stale results.
- RCSB prefers BinaryCIF and falls back to mmCIF; AlphaFold prefers a trusted same-origin BCIF URL and falls back to CIF.
- Post-processing, multisampling, illumination, and Hi-Z are disabled.
- Effective device-pixel ratio is capped at 1.5 and reduced for larger structures.
- Geometry quality and surface resolution adapt to atom count.
- Water and hydrogens are hidden by default.
- Long sequences use horizontal virtualization with overscan.
- Local and remote structure payloads have a 512 MiB safety ceiling; declared oversized remote bodies are rejected before body decoding.
- Development/browser benchmark records remain in memory and are capped at 20 loads.

These are implementation properties, not proof of a particular frame rate or memory ceiling.

## Established CPU microbenchmarks

Command:

```sh
npm run benchmark
```

Observed environment:

| Item | Value |
| --- | --- |
| CPU | Intel Core i5-5350U @ 1.80 GHz |
| OS | Darwin 21.6.0 |
| Node.js | v24.12.0 |
| Benchmark method | Warm-up, then seven samples; table reports median total time |

Observed results:

| Benchmark case | Iterations | Median total | Iterations/s |
| --- | ---: | ---: | ---: |
| Identifier detection | 25,000 | 15.828 ms | 1,579,438.9 |
| Residue expression parsing | 12,000 | 18.022 ms | 665,864.5 |
| Contextual article scan, approximately 42 KiB | 80 | 10.333 ms | 7,742.1 |
| Sequence mapping, 5,000 residues | 30 | 43.816 ms | 684.7 |

One identifier-detection iteration parses both `pdb_00001abc` and `AF-P69905-F1`; “iterations/s” is therefore the benchmark-loop rate, not a count of individual identifiers. One sequence-mapping iteration maps the complete synthetic 5,000-residue case.

The same run observed a Node heap delta of **28.70 MiB**. This is a before/after process-heap observation around the complete microbenchmark script. It is not peak memory, retained browser memory, Mol* memory, WebGL/GPU memory, or evidence of leak-free repeated loads.

## Established network-loader integration samples

The following single observations exercised the real loader/download paths in a browser-like integration environment:

| Request | Returned payload | Observed duration |
| --- | ---: | ---: |
| RCSB `1CRN` BinaryCIF | 151,351 bytes | 969.6 ms |
| AlphaFold `P69905` BinaryCIF | 107,708 bytes | 102.2 ms |
| Extended PDB `pdb_00001crn` BinaryCIF | 151,351 bytes | 507.6 ms |

These timings depend on network route, cache state, provider load, and the host machine. They are integration evidence, not latency targets, medians, cold-load browser timings, or directly comparable samples. No percentile can be inferred from one observation.

## Established real-Chrome smoke coverage

The CDP harness in `scripts/chrome-smoke-client.mjs` has completed successfully against a real Chrome/WebGL panel for:

- the unloaded panel, confirming no Mol* resource and no canvas before a structure request;
- the local `tests/fixtures/minimal.cif` fixture;
- chain/sequence extraction and residue selection;
- hide/show, isolate/show-all, surface, and selection-colour operations;
- replacement with an extended PDB identifier;
- replacement through the AlphaFold `P69905` path.

The harness also checks the panel at `320 × 700` CSS pixels with DPR 2 and fails on horizontal or vertical document overflow.

### Final headless Chrome harness run

The final packaged-code harness run used **headless Chrome 145 with SwiftShader**, a `320 × 700` viewport, and completed with **PASS / zero failures**.

| Load | Atoms | Acquisition | Download | Parse | Structure | Render | First frame | Total | JS heap after record |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Local `minimal.cif` | 6 | 13.6 ms | — | 19.6 ms | 34.6 ms | 355.9 ms | 1,429.9 ms | 4,859.6 ms | 45,289,351 bytes |
| Replacement `pdb_00001crn` | 327 | 451.4 ms | 450.9 ms | 34.8 ms | 4.4 ms | 50.1 ms | 1,001.8 ms | 1,552.3 ms | 38,545,410 bytes |

The remote duration includes a network-dependent RCSB request. Phase values come from ProtPeek's in-panel recorder; `total` also includes orchestration and work outside the listed phases, so the columns are not expected to sum exactly. The heap values are point-in-time Chromium JS-heap readings, not peaks, GPU memory, or a repeated-load leak assessment.

The synthetic rotation sample reported:

| Duration | Frames | FPS | Worst frame |
| ---: | ---: | ---: | ---: |
| 1,819.7 ms | 2 | **1.1** | 1,799.9 ms |

**This 1.1 fps result is below the intended interactive target and must not be presented as acceptable rendering performance.** SwiftShader is a software renderer in a headless environment; this sample is not representative of a real hardware GPU. It exposes a limitation of this smoke bench while still proving that the interaction path completes. A hardware-GPU browser run is required for representative FPS claims.

An earlier functional Chrome smoke also passed the AlphaFold `P69905` replacement path, but no final AlphaFold browser timing was recorded from the headless run above.

### Firefox 154 validation

A real Firefox 154.0.1 headless session, driven by geckodriver 0.35.0 in a
fresh temporary profile, installed the current ProtPeek Firefox archive. The
store-asset workflow loaded RCSB `1AON`, produced the real 640×400 capture, and
passed its reversible Focus/Isolate smoke checks without a residual error. The
local-fixture timings below are retained as implementation diagnostics rather
than a performance target.

WebDriver Classic cannot switch into Firefox's remote sidebar document. The same extension document was therefore opened in an extension tab for the file-input/WebGL portion of the test. That WebGL run used the immediately preceding build; the only later application changes were rejection logging around cancellation and the remote-payload size guard, neither of which changes the local Mol* rendering path. Loading `tests/fixtures/minimal.cif` produced one active WebGL2 canvas, chain `A`, ligand `ATP`, six atoms, a visible entity strip and inspector, and no visible error.

| Acquisition | Parse | Structure | Render | First frame | Total |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 2 ms | 8 ms | 7 ms | 67 ms | 1,103 ms | 2,329 ms |

This proves installation, native-sidebar opening, shared-panel startup, local parsing, and WebGL rendering in real Firefox. It does not prove drag-and-drop inside the native embedded sidebar, remote replacement, a Firefox FPS target, or hardware-GPU performance.

Manual invocation after opening a remotely debuggable Chrome panel:

```sh
node scripts/chrome-smoke-client.mjs \
  '<panel-CDP-websocket-url>' \
  '/absolute/path/to/tests/fixtures/minimal.cif' \
  'pdb_00001crn'
```

Run it again with `P69905` for the AlphaFold replacement path. Adding `?benchmark` to a production panel URL enables the in-panel timing/FPS helpers; development builds enable them automatically.

## Final bundle analysis

The following values were measured from the production outputs that generated the release archives. “Gzip diagnostic” is the sum of individually gzip-compressed files at level 9; the stores consume the ZIP sizes, not this diagnostic.

| Target | Raw unpacked | Gzip diagnostic | Store ZIP |
| --- | ---: | ---: | ---: |
| Chrome | 2,970,400 bytes | 860,556 bytes | 861,838 bytes |
| Firefox | 2,970,572 bytes | 860,632 bytes | 861,914 bytes |

| Target/category | Raw | Gzip diagnostic |
| --- | ---: | ---: |
| Mol* lazy chunk, both targets | 2,854,258 bytes | 791,744 bytes |
| Main UI HTML + JS + CSS, both targets | 50,160 bytes | 15,418 bytes |
| Chrome background, scanner, manifest, icons and notices | 65,982 bytes | 53,394 bytes |
| Firefox background, scanner, manifest, icons and notices | 66,154 bytes | 53,470 bytes |

Mol* accounts for 96.1% of the unpacked Chrome output and is isolated behind
the first-structure dynamic import. No UI framework is bundled. The larger
non-Mol* share versus earlier builds comes primarily from the real
GroEL–GroES-derived multi-resolution PNG icons.

## Measurements not available in this environment

These are intentionally reported as unmeasured rather than estimated. A future run must capture the exact production revision, browser version, hardware, operating system, cache state, fixture/identifier, and method alongside every value.

| Required measurement | Status |
| --- | --- |
| Representative Chrome hardware-GPU local load and warm replacement | Not measured; hardware-GPU run required |
| Representative Chrome hardware-GPU FPS, worst frame, and frames over 33.34 ms | Not measured; hardware-GPU run required |
| Final AlphaFold browser timing with cache/network state | Not measured in the final packaged run |
| Firefox remote replacement, interaction FPS, and repeated replacement | Not measured; representative Firefox run required |
| Repeated-replacement retained-memory analysis | Not measured; browser profiling run required |
| GPU/WebGL memory | Not exposed by the current harness |

## Verification commands

```sh
npm run typecheck
npm run lint
npm test
npm run benchmark
npm run build:firefox
npm run build:chrome
npm run verify:build
```

`verify:build` validates the generated manifests and security/permission invariants; it does not measure performance or bundle size. The Chrome CDP harness is currently manual and is not part of `npm test` or `verify:build`.
