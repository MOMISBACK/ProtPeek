// SPDX-License-Identifier: MPL-2.0
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, '.output/zotero');
const manifest = JSON.parse(await readFile(join(root, 'zotero/manifest.json'), 'utf8'));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  configFile: false,
  root: join(root, 'zotero/app'),
  base: './',
  publicDir: false,
  resolve: { alias: [{ find: 'wxt/browser', replacement: join(root, 'src/zotero/browserShim.ts') }] },
  build: { outDir: join(output, 'app'), emptyOutDir: true, target: 'firefox115', chunkSizeWarningLimit: 4000 },
});
await build({
  configFile: false,
  root,
  publicDir: false,
  build: {
    outDir: output,
    emptyOutDir: false,
    target: 'firefox115',
    minify: false,
    lib: { entry: join(root, 'src/zotero/bootstrap.ts'), formats: ['iife'], name: 'ProtPeekBootstrap', fileName: () => 'bootstrap.js' },
  },
});
for (const file of ['manifest.json', 'window.xhtml', 'locale']) {
  await cp(join(root, 'zotero', file), join(output, file), { recursive: true });
}
for (const file of ['icon-16.png', 'icon-48.png', 'icon-96.png', 'NOTICE.txt', 'THIRD_PARTY_NOTICES.txt']) {
  await cp(join(root, 'public', file), join(output, file));
}
await cp(join(root, 'LICENSE'), join(output, 'LICENSE'));
await writeFile(join(output, 'README.txt'),
  'ProtPeek for Zotero\nSource and installation instructions: https://github.com/MOMISBACK/ProtPeek/tree/main/zotero\nMPL-2.0. Mol* is bundled; see THIRD_PARTY_NOTICES.txt.\n');
const release = join(root, 'release');
await mkdir(release, { recursive: true });
const archive = join(release, `protpeek-zotero-${manifest.version}.xpi`);
// Python's standard-library ZIP writer keeps packaging dependency-free.
execFileSync('python3', ['-c',
  'import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED,compresslevel=9); [z.write(p,p.relative_to(root)) for p in sorted(root.rglob("*")) if p.is_file()]; z.close()',
  output, archive,
], { stdio: 'inherit' });
process.stdout.write(`Zotero plugin: ${archive}\n`);
