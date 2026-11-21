// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.output/android-web');
await build({
  configFile: false,
  root: join(root, 'src/android'),
  base: './',
  publicDir: false,
  build: { outDir: output, emptyOutDir: true, target: 'chrome100', chunkSizeWarningLimit: 4000 },
});
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
await cp(join(root, 'public/THIRD_PARTY_NOTICES.txt'), join(output, 'THIRD_PARTY_NOTICES.txt'));
const assets = join(root, 'android/app/src/main/assets/www');
// This subtree contains generated web assets only, never Android source files.
await rm(assets, { recursive: true, force: true });
await mkdir(dirname(assets), { recursive: true });
await cp(output, assets, { recursive: true });
process.stdout.write(`Android web assets: ${output}\nPackaged assets: ${assets}\n`);
