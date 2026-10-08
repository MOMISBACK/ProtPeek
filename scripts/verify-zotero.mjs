// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(join(root, 'zotero/manifest.json'), 'utf8'));
const output = join(root, '.output/zotero');
assert.equal(manifest.applications.zotero.id, 'protpeek-zotero@momisback.github.io');
assert.equal(new URL(manifest.applications.zotero.update_url).protocol, 'https:');
const bootstrap = await readFile(join(output, 'bootstrap.js'), 'utf8');
for (const hook of ['startup', 'shutdown', 'onMainWindowLoad', 'onMainWindowUnload']) {
  assert.ok(bootstrap.includes(hook), `Missing lifecycle hook: ${hook}`);
}
const html = await readFile(join(output, 'app/index.html'), 'utf8');
assert.ok(html.includes('Content-Security-Policy'), 'Viewer CSP missing');
assert.ok(!/<script[^>]+src=["']https?:/i.test(html), 'Remote executable code');
for (const match of html.matchAll(/(?:src|href)="(\.\/assets\/[^"#]+)"/g)) {
  await stat(join(output, 'app', match[1]));
}
const archive = join(root, 'release', `protpeek-zotero-${manifest.version}.xpi`);
const result = execFileSync('python3', ['-c', `
import json,sys,zipfile,xml.etree.ElementTree as ET
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None, 'ZIP corruption'
 names=z.namelist()
 for required in ['manifest.json','bootstrap.js','window.xhtml','app/index.html','LICENSE','THIRD_PARTY_NOTICES.txt','locale/en-US/protpeek.ftl']:
  assert required in names, 'Missing '+required
 ET.fromstring(z.read('window.xhtml'))
 assert not any(n.startswith('/') or '..' in n.split('/') for n in names)
 assert any('MolstarViewer' in n for n in names), 'Mol* is not bundled'
 assert not any('node_modules' in n or '.map' == n[-4:] for n in names)
 print(json.dumps({'files':len(names),'bytes':sum(i.file_size for i in z.infolist())}))
`, archive], { encoding: 'utf8' });
process.stdout.write(`Verified Zotero package: ${result}`);
