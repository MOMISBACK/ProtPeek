// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = join(root, '.output/android-web');
const packaged = join(root, 'android/app/src/main/assets/www');
const html = await readFile(join(output, 'index.html'), 'utf8');
assert.ok(html.includes('ProtPeek'), 'Missing application identity');
const sources = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
assert.ok(sources.some(source => source.endsWith('.js')), 'Missing bundled app module');
for (const source of sources) {
  if (source.startsWith('data:') || source.startsWith('#')) continue;
  assert.equal(/^https?:/i.test(source), false, 'The app must bundle its executable and style assets');
  await readFile(resolve(output, source));
}
const assets = await readdir(join(output, 'assets'));
assert.ok(assets.some(name => name.startsWith('MolstarViewer') && name.endsWith('.js')), 'Missing real Mol* renderer');
for (const name of ['index.html', 'LICENSE', 'THIRD_PARTY_NOTICES.txt']) {
  assert.deepEqual(await readFile(join(output, name)), await readFile(join(packaged, name)), `Packaged ${name} differs`);
}
process.stdout.write('Verified local Android web assets, renderer and license notices.\n');
