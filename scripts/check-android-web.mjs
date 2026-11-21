// SPDX-License-Identifier: MPL-2.0
// Exercise the actual Android web build in headless Chromium with a native-host
// stub and deterministic public-API fixtures. This is NOT an emulator/device,
// installation, Play acceptance or live-service availability check.
// Requires Node 24, npm dependencies, Chromium and .output/android-web/index.html.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, '.output/android-ui-check');
const WEB = join(ROOT, '.output/android-web');
const FIXTURE = join(ROOT, 'tests/fixtures/minimal.pdb');
const SIZES = [{ width: 360, height: 740 }, { width: 393, height: 851 }, { width: 800, height: 600 }];
const require = createRequire(import.meta.url);
const { CIF } = require('molstar/lib/commonjs/mol-io/reader/cif.js');
const report = {
  mode: 'Built Android UI in Chromium, native bridge stub, deterministic API responses',
  limitations: ['Not a native Android WebView or emulator test', 'No installability or Play review claim', 'Scientific API records below are synthetic UI test fixtures'],
  checks: [], screenshots: [], exceptions: [], requests: [], unexpectedRequests: [], interceptionErrors: [],
};

class Cdp {
  #socket;
  #nextId = 0;
  #pending = new Map();
  #events = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        globalThis.clearTimeout(pending.timeout);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } else {
        for (const listener of this.#events.get(message.method) ?? []) listener(message.params);
      }
    });
  }

  static async connect(url) {
    const socket = new globalThis.WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new Cdp(socket);
  }

  on(method, listener) {
    const listeners = this.#events.get(method) ?? [];
    listeners.push(listener);
    this.#events.set(method, listeners);
  }

  call(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timeout = globalThis.setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 30_000);
      this.#pending.set(id, { resolve, reject, timeout });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }

  close() { this.#socket.close(); }
}

async function serve(root) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      let path = resolve(root, `.${decodeURIComponent(url.pathname)}`);
      if (!path.startsWith(`${root}${sep}`) && path !== root) throw new Error('Invalid asset path');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(await readFile(path));
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function chromePath() {
  for (const candidate of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean)) {
    try { await access(candidate); return candidate; } catch { /* Try the next installed browser. */ }
  }
  throw new Error('Chrome is not installed. Set CHROME_PATH or run this check on the Ubuntu CI runner.');
}


async function waitFor(client, expression, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await delay(100);
  }
  const state = await client.evaluate(`({ready: document.querySelector('#app')?.dataset.ready,
    viewer: document.querySelector('.viewer-frame')?.dataset.viewerState,
    status: document.querySelector('.android-load-status')?.textContent,
    search: document.querySelector('.android-search-status')?.textContent})`).catch(() => null);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function settled(client) {
  await client.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function click(client, selector) {
  assert.equal(await client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled || !element.getClientRects().length || element.closest('[inert]')) return false;
    element.click(); return true;
  })()`), true, `Control is missing, hidden, inert or disabled: ${selector}`);
}

async function screenshot(client, name) {
  await settled(client);
  const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(OUTPUT, `${name}.png`), Buffer.from(data, 'base64'));
  report.screenshots.push(`${name}.png`);
}

async function viewport(client, size, theme) {
  await client.call('Emulation.setDeviceMetricsOverride', {
    ...size, deviceScaleFactor: 1, mobile: true, screenWidth: size.width, screenHeight: size.height,
  });
  await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await settled(client);
}

async function layout(client, name) {
  const result = await client.evaluate(`(() => {
    const visible = [...document.querySelectorAll('.android-header button, .android-query, .android-organism,
      .android-primary, .android-secondary, .android-result-action, .android-tools button,
      .compact-select, .selection-input, .primary-small, .view-background-choice')]
      .filter(el => el.getClientRects().length && el.getBoundingClientRect().height > 0);
    const outside = visible.filter(el => {
      const rect = el.getBoundingClientRect(); return rect.left < -1 || rect.right > innerWidth + 1;
    }).map(el => el.getAttribute('aria-label') || el.textContent.trim());
    const header = document.querySelector('.android-header').getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, shellWidth: document.querySelector('.android-app').scrollWidth,
      headerTop: header.top, headerBottom: header.bottom, outside };
  })()`);
  assert.ok(result.documentWidth <= result.width + 1, `${name}: document overflow ${JSON.stringify(result)}`);
  assert.ok(result.bodyWidth <= result.width + 1, `${name}: body overflow ${JSON.stringify(result)}`);
  assert.ok(result.shellWidth <= result.width + 1, `${name}: app overflow ${JSON.stringify(result)}`);
  assert.deepEqual(result.outside, [], `${name}: controls exceed the mobile width`);
  assert.ok(result.headerTop >= -1 && result.headerBottom <= result.height, `${name}: header is clipped`);
  report.checks.push({ name, ...result });
}

async function checkInspector(client, name) {
  const dimensions = await client.evaluate(`(() => {
    const inspector = document.querySelector('.inspector');
    const frame = document.querySelector('.viewer-frame').getBoundingClientRect();
    const canvas = document.querySelector('.viewer-host canvas');
    const panel = inspector.getBoundingClientRect();
    const editor = document.querySelector('.selection-editor');
    const sequence = document.querySelector('.sequence-scroll');
    inspector.scrollTop = inspector.scrollHeight;
    return { frameHeight: frame.height, frameBottom: frame.bottom, panelHeight: panel.height,
      panelBottom: panel.bottom, clientHeight: inspector.clientHeight, scrollHeight: inspector.scrollHeight,
      overflowY: getComputedStyle(inspector).overflowY,
      editorFound: Boolean(editor), sequenceFound: Boolean(sequence),
      canvasWidth: canvas.width, canvasHeight: canvas.height, viewportHeight: innerHeight };
  })()`);
  assert.ok(dimensions.frameHeight >= Math.min(210, dimensions.viewportHeight * 0.32) - 2,
    `${name}: molecular renderer collapsed: ${JSON.stringify(dimensions)}`);
  assert.ok(dimensions.canvasWidth > 0 && dimensions.canvasHeight > 0, `${name}: WebGL canvas has no size`);
  assert.ok(dimensions.panelHeight > 50 && dimensions.panelBottom <= dimensions.viewportHeight + 1,
    `${name}: inspector is clipped below the viewport`);
  assert.equal(dimensions.overflowY, 'auto', `${name}: inspector must scroll`);
  assert.ok(dimensions.editorFound && dimensions.sequenceFound, `${name}: residue controls missing`);
  await settled(client);
  const reachable = await client.evaluate(`(() => {
    const inspector = document.querySelector('.inspector').getBoundingClientRect();
    const summary = document.querySelector('.customization-toggle').getBoundingClientRect();
    const sequence = document.querySelector('.sequence-scroll').getBoundingClientRect();
    return { sequenceTop: sequence.top, sequenceBottom: sequence.bottom,
      panelTop: inspector.top, panelBottom: inspector.bottom, summaryBottom: summary.bottom };
  })()`);
  assert.ok(reachable.sequenceTop >= Math.max(reachable.panelTop, reachable.summaryBottom) - 2
    && reachable.sequenceBottom <= reachable.panelBottom + 2,
  `${name}: sequence cannot be reached by scrolling: ${JSON.stringify(reachable)}`);
  await client.evaluate("document.querySelector('.inspector').scrollTop = 0");
  report.checks.push({ name, ...dimensions, reachable });
}

function nativeStub(fixtureBase64) {
  return `(() => {
    const state = globalThis.__ANDROID_UI_QA__ = {
      documentId: Math.random().toString(36), readyCalls: 0, openCalls: 0, exports: [], shares: [],
    };
    // This origin is a temporary isolated CI server, never the user's app data.
    localStorage.clear();
    globalThis.ProtPeekAndroid = {
      getTheme: () => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      ready: () => { state.readyCalls++; },
      openFile: () => {
        state.openCalls++;
        queueMicrotask(() => window.dispatchEvent(new CustomEvent('protpeek:file-opened', {
          detail: { name: 'minimal.pdb', mimeType: 'chemical/x-pdb', base64: ${JSON.stringify(fixtureBase64)} },
        })));
      },
      exportFile: payload => { state.exports.push(JSON.parse(payload)); },
      shareFile: payload => { state.shares.push(JSON.parse(payload)); },
    };
  })();`;
}

// All scientific records in this harness are explicitly synthetic test data.
// They exercise exact associations, not the factual biology of the PDB IDs.
const FIXTURE_DOI = '10.5555/protpeek-ui-fixture';
const proteinFixture = {
  primaryAccession: 'P0A6F5', entryType: 'UniProtKB reviewed (Swiss-Prot)',
  proteinDescription: { recommendedName: { fullName: { value: 'GroEL UI test fixture' } } },
  organism: { scientificName: 'Escherichia coli (strain K12)', taxonId: 83333 },
  genes: [{ geneName: { value: 'groEL' } }], sequence: { length: 548 },
};
const articleFixture = {
  id: 'PROTPEEK-UI-FIXTURE', source: 'MED', doi: FIXTURE_DOI,
  title: 'ProtPeek UI test: a chaperonin structure', pubYear: '2026',
  authorString: 'Automated test fixture; not a scientific citation',
};
function entryFixture(id, matched) {
  return {
    rcsb_id: id, struct: { title: matched ? 'GroEL structure UI fixture' : 'Unrelated structure UI fixture' },
    exptl: [{ method: 'X-RAY DIFFRACTION' }], rcsb_entry_info: { resolution_combined: [3.0] },
    rcsb_primary_citation: { pdbx_database_id_DOI: matched ? FIXTURE_DOI : '10.5555/unrelated-ui-fixture' },
    polymer_entities: [{
      rcsb_entity_source_organism: [{ ncbi_scientific_name: matched ? 'Escherichia coli (strain K12)' : 'Homo sapiens', ncbi_taxonomy_id: matched ? 83333 : 9606 }],
      rcsb_polymer_entity_container_identifiers: { reference_sequence_identifiers: [{ database_name: 'UniProt', database_accession: matched ? 'P0A6F5' : 'P69905' }] },
    }],
  };
}

async function intercept(client, origin) {
  client.on('Fetch.requestPaused', event => {
    const handle = async () => {
      const { requestId, request } = event;
      const url = new URL(request.url);
      if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
        await client.call('Fetch.continueRequest', { requestId }); return;
      }
      const headers = [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS' },
        { name: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        { name: 'Cache-Control', value: 'no-store' },
      ];
      let payload, status = 200;
      const known = ['rest.uniprot.org', 'www.ebi.ac.uk', 'search.rcsb.org', 'data.rcsb.org', 'alphafold.ebi.ac.uk'].includes(url.hostname);
      if (request.method === 'OPTIONS' && known) payload = {};
      else if (url.hostname === 'rest.uniprot.org' && url.pathname === '/uniprotkb/search') {
        payload = { results: [proteinFixture] };
      } else if (url.hostname === 'rest.uniprot.org' && url.pathname === '/uniprotkb/P0A6F5.json') {
        payload = proteinFixture;
      } else if (url.hostname === 'www.ebi.ac.uk' && url.pathname === '/europepmc/webservices/rest/search') {
        payload = { hitCount: 1, resultList: { result: [articleFixture] } };
      } else if (url.hostname === 'search.rcsb.org' && url.pathname === '/rcsbsearch/v2/query') {
        payload = { total_count: 2, result_set: [{ identifier: '1AON' }, { identifier: '1CRN' }] };
      } else if (url.hostname === 'data.rcsb.org' && url.pathname === '/graphql') {
        const requested = JSON.parse(request.postData || '{}').variables?.ids || [];
        payload = { data: { entries: requested.map(id => entryFixture(id, id === '1AON')) } };
      } else if (url.hostname === 'alphafold.ebi.ac.uk' && url.pathname === '/api/prediction/P0A6F5') {
        payload = {}; status = 404;
      } else {
        report.unexpectedRequests.push({ method: request.method, url: url.href });
        await client.call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return;
      }
      if (request.method !== 'OPTIONS') report.requests.push({ method: request.method, url: url.href, postData: request.postData });
      await client.call('Fetch.fulfillRequest', { requestId, responseCode: status, responseHeaders: headers,
        body: Buffer.from(JSON.stringify(payload)).toString('base64') });
    };
    void handle().catch(error => {
      report.interceptionErrors.push(String(error));
      void client.call('Fetch.failRequest', { requestId: event.requestId, errorReason: 'Failed' }).catch(() => {});
    });
  });
  await client.call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
}

async function openLocalFixture(client) {
  await click(client, '.android-file-row button');
  await waitFor(client, `globalThis.__ANDROID_UI_QA__.openCalls > 0
    && document.querySelector('.viewer-frame')?.dataset.viewerState === 'ready'
    && document.querySelector('.viewer-host canvas')?.width > 0
    && document.querySelector('.viewer-host canvas')?.height > 0`, 'native file import and real Mol* renderer', 45_000);
  assert.equal(await client.evaluate("document.querySelector('.android-load-status')?.dataset.error"), 'false', 'Local import reported an error');
  assert.equal(await client.evaluate("document.querySelector('.android-app')?.dataset.screen"), 'structure');
  report.checks.push({ name: 'native-file-bridge-and-real-molstar-load', fixture: 'minimal.pdb' });
}

async function exportPayload(client, format, action) {
  const list = action === 'share' ? 'shares' : 'exports';
  const before = await client.evaluate(`globalThis.__ANDROID_UI_QA__.${list}.length`);
  await click(client, '[aria-label="Export structure or image"]');
  await click(client, `[data-export-format="${format}"][data-export-action="${action}"]`);
  await waitFor(client, `globalThis.__ANDROID_UI_QA__.${list}.length > ${before}`, `${action} ${format} native payload`, 30_000);
  return client.evaluate(`globalThis.__ANDROID_UI_QA__.${list}[${before}]`);
}

async function checkCif(client, action, theme) {
  const file = await exportPayload(client, 'cif', action);
  assert.match(file.filename, /\.cif$/i, 'CIF filename is missing');
  assert.equal(file.mimeType, 'chemical/x-cif');
  assert.equal(typeof file.text, 'string');
  const parsed = await CIF.parseText(file.text).run();
  assert.equal(parsed.isError, false, 'Actual Mol* export is not readable mmCIF');
  const atoms = parsed.result.blocks[0]?.categories.atom_site;
  assert.ok(atoms, 'CIF contains no atomic coordinates');
  assert.equal(atoms.rowCount, 4, 'Local input atomic coordinates were lost or invented');
  assert.equal(atoms.getField('label_comp_id').str(0), 'ALA');
  assert.ok(Array.from({ length: atoms.rowCount }, (_, i) => atoms.getField('label_comp_id').str(i)).includes('MG'), 'Ligand missing from CIF');
  const coordinates = ['Cartn_x', 'Cartn_y', 'Cartn_z'].map(field => atoms.getField(field).float(0));
  assert.deepEqual(coordinates, [0, 0, 0], 'Exported coordinates differ from the input fixture');
  await writeFile(join(OUTPUT, `${theme}-${action}-actual-export.cif`), file.text);
  report.checks.push({ name: `${theme}-${action}-cif-native-export`, filename: file.filename, atoms: atoms.rowCount, firstAtom: coordinates });
}

async function checkPng(client, action, theme, background) {
  let payload, pixels;
  for (let attempt = 0; attempt < 10; attempt++) {
    await settled(client);
    payload = await exportPayload(client, 'png', action);
    assert.equal(payload.mimeType, 'image/png');
    assert.match(payload.filename, /\.png$/i);
    const bytes = Buffer.from(payload.base64, 'base64');
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'Export is not a PNG');
    pixels = await client.evaluate(`(async () => {
      const image = new Image(); image.src = 'data:image/png;base64,' + ${JSON.stringify(payload.base64)};
      await image.decode(); const output = document.createElement('canvas');
      output.width = image.width; output.height = image.height;
      const ctx = output.getContext('2d'); ctx.drawImage(image, 0, 0);
      const bytes = ctx.getImageData(0, 0, image.width, image.height).data;
      const background = ${background === 'black' ? 0 : 255}; let foreground = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i + 3] && Math.max(Math.abs(bytes[i] - background), Math.abs(bytes[i + 1] - background), Math.abs(bytes[i + 2] - background)) > 20) foreground++;
      }
      return { width: image.width, height: image.height, foreground,
        corners: [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]) };
    })()`);
    if (pixels.foreground > 20) break;
    await delay(200);
  }
  assert.ok(pixels.width >= 1 && pixels.height >= 1, 'PNG dimensions are invalid');
  assert.ok(pixels.foreground > 20, 'PNG export has no visible molecular geometry');
  for (const corner of pixels.corners) assert.deepEqual(corner, [background === 'black' ? 0 : 255, background === 'black' ? 0 : 255, background === 'black' ? 0 : 255, 255], `PNG background is not ${background}`);
  const name = `${theme}-${action}-actual-export-${background}.png`;
  await writeFile(join(OUTPUT, name), Buffer.from(payload.base64, 'base64'));
  report.screenshots.push(name);
  report.checks.push({ name: `${theme}-${action}-png-native-export`, filename: payload.filename, ...pixels });
}

async function checkViewerActions(client, theme) {
  const rotate = '[aria-label="Auto rotate"]';
  assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(rotate)}).getAttribute('aria-pressed')`), 'false');
  await click(client, rotate);
  await waitFor(client, `document.querySelector(${JSON.stringify(rotate)}).getAttribute('aria-pressed') === 'true'`, 'rotation enabled');
  // Compare frames while rotation is already enabled; button state is identical.
  await delay(150);
  const rect = await client.evaluate(`(() => { const r = document.querySelector('.viewer-frame').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; })()`);
  const first = await client.call('Page.captureScreenshot', { format: 'png', clip: rect });
  await delay(600);
  const second = await client.call('Page.captureScreenshot', { format: 'png', clip: rect });
  assert.notEqual(createHash('sha256').update(first.data).digest('hex'), createHash('sha256').update(second.data).digest('hex'), 'Auto rotate did not change the rendered molecular frame');
  await client.evaluate("window.dispatchEvent(new CustomEvent('protpeek:pause'))");
  await waitFor(client, `document.querySelector(${JSON.stringify(rotate)}).getAttribute('aria-pressed') === 'false'`, 'native pause stops rotation');
  await click(client, '[aria-label="Reset view"]');
  await click(client, '[aria-label="Expand viewer"]');
  await waitFor(client, "document.querySelector('.viewer-frame').classList.contains('is-expanded')", 'viewer expansion');
  const expanded = await client.evaluate(`(() => {
    const frame = document.querySelector('.viewer-frame').getBoundingClientRect();
    return { x: frame.x, y: frame.y, width: frame.width, height: frame.height,
      viewportWidth: innerWidth, viewportHeight: innerHeight,
      headerInert: document.querySelector('.android-header').inert,
      inspectorInert: document.querySelector('.inspector').inert };
  })()`);
  assert.ok(Math.abs(expanded.x) <= 1 && Math.abs(expanded.y) <= 1, 'Expanded viewer does not start at viewport origin');
  assert.ok(Math.abs(expanded.width - expanded.viewportWidth) <= 2 && Math.abs(expanded.height - expanded.viewportHeight) <= 2, 'Expanded viewer does not fill viewport');
  assert.equal(expanded.headerInert, true); assert.equal(expanded.inspectorInert, true);
  await screenshot(client, `${theme}-expanded-mobile-viewer`);
  await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  await waitFor(client, "!document.querySelector('.viewer-frame').classList.contains('is-expanded')", 'Escape restores normal viewer');
  await click(client, '[aria-label="Expand viewer"]');
  assert.equal(await client.evaluate('window.ProtPeekAndroidUI.back()'), true, 'Native Back did not consume expanded viewer');
  await waitFor(client, "!document.querySelector('.viewer-frame').classList.contains('is-expanded')", 'native Back collapses viewer');
  assert.equal(await client.evaluate("document.querySelector('.android-header').inert || document.querySelector('.inspector').inert"), false, 'Expanded-view inert state was not restored');
  await click(client, rotate);
  await click(client, '#android-search-tab');
  await waitFor(client, `document.querySelector(${JSON.stringify(rotate)}).getAttribute('aria-pressed') === 'false'`, 'Search screen stops rotation');
  await click(client, '#android-structure-tab');
  report.checks.push({ name: `${theme}-rotate-real-render-pause-reset-expand-back`, expanded });
}

async function checkResidueSelection(client, theme) {
  await click(client, '.residue-cell:not(:disabled)');
  await waitFor(client, "document.querySelector('.selection-input').value === 'A:5'", 'sequence selection synchronizes Residues');
  assert.equal(await client.evaluate("document.querySelectorAll('.residue-cell.is-selected').length"), 1);
  await client.evaluate("document.querySelector('.selection-input').value = 'A:500'");
  await click(client, '.selection-editor .primary-small');
  await waitFor(client, "document.querySelector('.field-error').textContent.includes('not observed')", 'invalid selection feedback');
  assert.equal(await client.evaluate("document.querySelectorAll('.residue-cell.is-selected').length"), 1, 'Invalid selection replaced the previous selection');
  await client.evaluate("document.querySelector('.selection-input').value = 'A:5'");
  await click(client, '.selection-editor .primary-small');
  report.checks.push({ name: `${theme}-residue-selection-and-invalid-input`, expected: 'A:5' });
}

async function submitSearch(client, query, organism) {
  await client.evaluate(`(() => {
    document.querySelector('#android-query').value = ${JSON.stringify(query)};
    document.querySelector('#android-organism').value = ${JSON.stringify(organism)};
    document.querySelector('.android-search-form').requestSubmit();
  })()`);
  await waitFor(client, `document.querySelector('.android-app').dataset.searchState !== 'loading'
    && !document.querySelector('.android-search-form button[type=submit]').disabled`, 'deterministic search results');
}

async function checkSearch(client) {
  await click(client, '#android-search-tab');
  await submitSearch(client, 'groEL', 'Escherichia coli');
  const first = await client.evaluate(`({state: document.querySelector('.android-app').dataset.searchState,
    proteins: [...document.querySelectorAll('.android-result[data-kind=protein]')].map(el => ({id: el.dataset.id, text: el.textContent})),
    articles: document.querySelectorAll('.android-result[data-kind=article]').length,
    structures: document.querySelectorAll('.android-result[data-kind=structure]').length})`);
  assert.equal(first.state, 'complete', 'Mocked search unexpectedly failed');
  assert.equal(first.proteins.length, 1); assert.equal(first.proteins[0].id, 'P0A6F5');
  assert.match(first.proteins[0].text, /Escherichia coli \(strain K12\)/);
  assert.equal(first.articles, 1); assert.equal(first.structures, 0, 'A gene search automatically selected a structure');
  const queryRequest = report.requests.find(request => request.url.startsWith('https://rest.uniprot.org/uniprotkb/search?'));
  assert.ok(queryRequest, 'UniProt request was not observed');
  assert.match(new URL(queryRequest.url).searchParams.get('query'), /organism_name:"Escherichia coli"/, 'Organism filter was dropped');
  await screenshot(client, 'search-protein-organism-and-publication-fixtures');
  await click(client, '.android-result[data-kind=protein] .android-result-action');
  await waitFor(client, "document.querySelector('.android-app').dataset.searchState !== 'loading' && !document.querySelector('.android-results').inert", 'exact protein-associated structures');
  const proteinStructures = await client.evaluate("[...document.querySelectorAll('.android-result[data-kind=structure]')].map(el => ({id: el.dataset.id, text: el.textContent, source: el.dataset.source}))");
  assert.deepEqual(proteinStructures.map(item => item.id), ['1AON'], 'Mismatched protein accession was not excluded');
  assert.match(proteinStructures[0].text, /Escherichia coli \(strain K12\)/);
  assert.ok(!proteinStructures[0].text.includes('Homo sapiens'), 'A homolog organism replaced the selected organism');
  assert.equal(proteinStructures[0].source, 'pdb');
  assert.equal(await client.evaluate('window.ProtPeekAndroidUI.back()'), true, 'Back did not restore the protein/article candidates');
  await click(client, '.android-result[data-kind=article] .android-result-action');
  await waitFor(client, "document.querySelector('.android-app').dataset.searchState !== 'loading' && !document.querySelector('.android-results').inert", 'primary publication-associated structures');
  const articleStructures = await client.evaluate("[...document.querySelectorAll('.android-result[data-kind=structure]')].map(el => el.dataset.id)");
  assert.deepEqual(articleStructures, ['1AON'], 'An unrelated primary citation was presented as associated');
  const articleQuery = report.requests.some(request => request.url.startsWith('https://search.rcsb.org/') && (request.postData || '').includes('rcsb_primary_citation.pdbx_database_id_DOI') && (request.postData || '').includes(FIXTURE_DOI));
  assert.equal(articleQuery, true, 'Article-to-PDB lookup did not use the exact primary DOI field');
  report.checks.push({ name: 'search-native-UI-organism-protein-and-primary-article-association', first, proteinStructures, articleStructures, exactDoiQuery: true });
  await screenshot(client, 'search-exact-primary-article-association-fixture');
}

async function checkTheme(client, origin, theme) {
  await viewport(client, SIZES[0], theme);
  const old = await client.evaluate('globalThis.__ANDROID_UI_QA__?.documentId');
  await client.call('Page.navigate', { url: `${origin}/` });
  await waitFor(client, `document.querySelector('#app')?.dataset.ready === 'true'
    && globalThis.__ANDROID_UI_QA__?.readyCalls === 1
    && globalThis.__ANDROID_UI_QA__?.documentId !== ${JSON.stringify(old ?? null)}`, `${theme} Android ready handshake`);
  assert.equal(await client.evaluate('document.documentElement.dataset.nativeTheme'), theme, 'Native theme handshake was ignored');
  assert.equal(await client.evaluate("document.querySelector('#android-structure-tab').disabled"), true, 'Empty Structure tab should not be enabled');
  await layout(client, `${theme}-search-360x740`);
  await screenshot(client, `${theme}-search-mobile`);
  await openLocalFixture(client);
  await click(client, '.customization-toggle');
  for (const size of SIZES) {
    await viewport(client, size, theme);
    const label = `${theme}-viewer-${size.width}x${size.height}`;
    await layout(client, label);
    await checkInspector(client, `${label}-inspector-reachable`);
    await screenshot(client, label);
  }
  await viewport(client, SIZES[1], theme);
  await checkViewerActions(client, theme);
  await checkResidueSelection(client, theme);
  // Restore all observed atoms before checking coordinate exports.
  await click(client, '[aria-label="Reset view"]');
  await checkCif(client, 'save', theme);
  await checkCif(client, 'share', theme);
  await click(client, '[data-background="white"]');
  await waitFor(client, "document.querySelector('[data-background=white]').getAttribute('aria-pressed') === 'true'", 'white molecular background');
  await checkPng(client, 'save', theme, 'white');
  await click(client, '[data-background="black"]');
  await waitFor(client, "document.querySelector('[data-background=black]').getAttribute('aria-pressed') === 'true'", 'black molecular background');
  await checkPng(client, 'share', theme, 'black');
  if (theme === 'light') await checkSearch(client);
  report.checks.push({ name: `${theme}-native-ready-and-export-contracts`, nativeReady: true, cifAndPng: true, saveAndShare: true });
}

await mkdir(OUTPUT, { recursive: true });
let chrome, profile, server, client, stderr = '', spawnError;
try {
  await access(join(WEB, 'index.html'));
  const fixture = await readFile(FIXTURE);
  const executable = await chromePath();
  const hosted = await serve(WEB); server = hosted.server;
  profile = await mkdtemp(join(tmpdir(), 'protpeek-android-ui-check-'));
  chrome = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.on('error', error => { spawnError = error; });
  chrome.stderr.on('data', data => { stderr += data.toString(); });
  let port;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, `Chromium did not start: ${stderr.slice(-2000)}`);
  const targets = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chromium has no debuggable page');
  client = await Cdp.connect(page.webSocketDebuggerUrl);
  await client.call('Page.enable'); await client.call('Runtime.enable');
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: nativeStub(fixture.toString('base64')) });
  await intercept(client, hosted.origin);
  for (const theme of ['light', 'dark']) await checkTheme(client, hosted.origin, theme);
  assert.deepEqual(report.exceptions, [], 'Uncaught Android UI exceptions');
  assert.deepEqual(report.unexpectedRequests, [], 'An unmocked external request was attempted');
  assert.deepEqual(report.interceptionErrors, [], 'Deterministic API interception failed');
  report.passed = true;
  process.stdout.write(`Android web UI passed: ${report.checks.length} checks, ${report.screenshots.length} images.\n`);
} catch (error) {
  report.passed = false; report.error = error.stack ?? String(error);
  if (client) try { await screenshot(client, 'failure'); } catch { /* Preserve the original failure. */ }
  process.stderr.write(`${report.error}\n`); process.exitCode = 1;
} finally {
  await writeFile(join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  client?.close(); chrome?.kill();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
