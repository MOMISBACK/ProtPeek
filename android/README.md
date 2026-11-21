# ProtPeek Android prototype

Android application ID: `com.protpeek.app`. Version: **0.1.0**, version code **1**.
The minimum Android API is 26; a modern Android System WebView with working
WebGL is required. Compile/target API: 36.

## Features

- Search genes/proteins with an organism filter, PDB/UniProt/AlphaFold IDs,
  article titles, DOI and PMID through UniProt, RCSB, AlphaFold DB and Europe PMC.
- Experimental PDB structures and predicted AlphaFold models are distinct.
  Protein matches verify UniProt accessions; article matches verify primary
  DOI/PMID associations. Partial provider failures are displayed explicitly.
- Open local PDB, CIF/mmCIF, BCIF and GRO files through Android's document picker,
  Open with and Share actions.
- Use the existing Mol* renderer, sequence/residue selection, cartoon/surface,
  colors, chain visibility, focus/isolation, white/black background and rotation.
- Save and share PNG images and visible-structure PDBx/mmCIF files through native
  Android dialogs. Local files are not uploaded to ProtPeek or search providers.
- Follow the system light/dark appearance and retain the approved blue/GroEL UI.

## Prototype boundaries

The mobile file/download/export limit is **32 MiB**. Molecular geometry and
surface memory use can exceed the file size; very large assemblies may still
exceed a phone's GPU/RAM capacity. Quality adapts to atom count.

Recent items store remote identifiers and metadata, not offline structure files.
Search and remote reopening require a network connection. Local imports work
offline. GRO opens its first frame only; there is no trajectory playback.
The app retrieves existing AlphaFold DB predictions; it does not run a new
AlphaFold calculation. A lack of an indexed association does not prove that a
protein or publication has no structure.

PNG preserves the rendered view. mmCIF stores coordinates of the visible
structure, not the view's colors, selection styling or camera. Exports do not
modify the original file.

## Build

Use Node 24/npm, JDK 17, Android SDK platform 36/build-tools 36.0.0, and the
pinned Gradle 8.13 wrapper. The Android Gradle plugin is 8.13.2.

```sh
npm ci
npm run build:android:web
npm run verify:android:web
cd android
./gradlew :app:bundleRelease :app:assembleRelease
```

Web assets are generated into `.output/android-web/` and copied into the app's
assets; they are not fetched from a hosted website. The generated subtree is
ignored by Git. Native file access is mediated by the document picker, a bounded
trusted-origin bridge and a FileProvider for explicitly shared exports.

The `Android prototype` workflow builds unsigned release artifacts and runs web
and Android WebView instrumentation checks. It never receives the signing key.
See [validation results and limits](./VALIDATION.md).

## Signing and downloads

The permanent upload key is kept outside this repository. Its **public**
certificate is `signing-certificate.pem`; SHA-256 fingerprint:

`72b3aeede171bec6ad684d1e207abe29b55909f9633b5e5546ccdefcb38fa685`

Signed artifacts and their hashes/build provenance are recorded in
`releases/release.json`. `scripts/verify-android-release.py` verifies both
signatures and embedded package/version identities using the public certificate,
SDK aapt2 and checksum-pinned bundletool 1.18.3. No private key is required in CI.
Publication also checks that the recorded source workflow completed its build,
mobile UI checks and native WebView test successfully.
The publication workflow attaches the verified APK and AAB to the
`android-v0.1.0` GitHub prerelease.

Install the APK directly for testing. The signed AAB is intended for a Google
Play testing upload and cannot be installed as an ordinary APK. Store publishing
is separate from this GitHub prototype release.
