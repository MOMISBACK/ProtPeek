// SPDX-License-Identifier: MPL-2.0
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';

const ROOT_DIR = resolve(import.meta.dirname, '..');
const OUTPUT_DIR = resolve(ROOT_DIR, '.output');
const RELEASE_DIR = resolve(ROOT_DIR, 'release');
const packageJson = JSON.parse(
  readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8'),
);

if (typeof packageJson.name !== 'string' || packageJson.name.length === 0) {
  throw new Error('package.json must contain a non-empty name');
}

if (typeof packageJson.version !== 'string' || packageJson.version.length === 0) {
  throw new Error('package.json must contain a non-empty version');
}

const sourcePrefix = `${packageJson.name}-${packageJson.version}`;
const destinationPrefix = `ProtPeek-${packageJson.version}`;
const artefacts = ['chrome', 'firefox', 'sources'].map((kind) => ({
  destination: resolve(RELEASE_DIR, `${destinationPrefix}-${kind}.zip`),
  source: resolve(OUTPUT_DIR, `${sourcePrefix}-${kind}.zip`),
}));

for (const { source } of artefacts) {
  let size;
  try {
    size = statSync(source).size;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Missing release artefact ${source}. Run the Firefox and Chrome zip commands first. (${reason})`,
      { cause: error },
    );
  }

  if (size === 0) {
    throw new Error(`Release artefact is empty: ${source}`);
  }

  const signature = readFileSync(source, { encoding: null, flag: 'r' }).subarray(0, 2);
  if (signature.length !== 2 || signature[0] !== 0x50 || signature[1] !== 0x4b) {
    throw new Error(`Release artefact is not a ZIP file: ${source}`);
  }
}

mkdirSync(RELEASE_DIR, { recursive: true });

for (const { destination, source } of artefacts) {
  copyFileSync(source, destination);
  const size = statSync(destination).size;
  process.stdout.write(
    `Copied ${basename(source)} -> release/${basename(destination)} (${size} bytes)\n`,
  );
}
