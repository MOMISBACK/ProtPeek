// SPDX-License-Identifier: MPL-2.0
// Render the built Chrome/Firefox UI in Chromium over local HTTP. Extension APIs
// are stubbed; this checks real DOM/WebGL/PNG behavior, not native installation.
// Requires Node 24 and Google Chrome (CHROME_PATH may select another Chromium).
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { URL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT = join(ROOT, '.output/ui-check');
const FIXTURE = join(ROOT, 'tests/fixtures/minimal.pdb');
const GRO_FIXTURE = join(ROOT, 'tests/fixtures/minimal-two-frame.gro');
const require = createRequire(import.meta.url);
const { CIF } = require('molstar/lib/commonjs/mol-io/reader/cif.js');
const report = {
  mode: 'Chromium rendering of HTTP-hosted builds with extension API stubs',
  checks: [],
  screenshots: [],
  exceptions: [],
};

const extensionStub = `(() => {
  globalThis.__UI_CHECK_DOCUMENT__ = Math.random();
  const event = () => ({ addListener() {}, removeListener() {} });
  const key = 'protpeek-ui-check-storage';
  const read = () => JSON.parse(localStorage.getItem(key) || '{}');
  const api = {
    runtime: { id: 'protpeek-ui-check', onMessage: event(), sendMessage: async () => ({ refreshed: false }) },
    windows: { getCurrent: async () => ({ id: 1 }) },
    tabs: {
      query: async () => [], get: async () => ({ id: 1, active: true, windowId: 1, status: 'complete' }),
      onActivated: event(), onUpdated: event(),
    },
    storage: {
      onChanged: event(),
      session: { get: async () => ({}), remove: async () => {} },
      local: {
        get: async (keys) => Object.fromEntries(keys.filter((key) => key in read()).map((key) => [key, read()[key]])),
        set: async (values) => localStorage.setItem(key, JSON.stringify({ ...read(), ...values })),
      },
    },
  };
  globalThis.browser = api;
  globalThis.chrome = api;
  const originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('data:image/png')) {
      globalThis.__UI_CHECK_PNG__ = this.href;
      return;
    }
    if (this.download && this.href.startsWith('blob:')) {
      const filename = this.download;
      globalThis.__UI_CHECK_STRUCTURE__ = fetch(this.href).then(async response => ({
        filename, text: await response.text(),
      }));
      return;
    }
    return originalClick.call(this);
  };
})();`;

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

async function waitFor(client, expression, label, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function settled(client) {
  await client.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
}

async function reload(client) {
  const previous = await client.evaluate('globalThis.__UI_CHECK_DOCUMENT__');
  await client.call('Page.reload');
  await waitFor(client, `globalThis.__UI_CHECK_DOCUMENT__ !== ${JSON.stringify(previous)}
    && document.readyState === 'complete' && document.querySelector('#page-tab') !== null`, 'fresh panel document');
}

async function screenshot(client, name) {
  await settled(client);
  const { data } = await client.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(OUTPUT, `${name}.png`), Buffer.from(data, 'base64'));
  report.screenshots.push(`${name}.png`);
}

async function layout(client, label, selector) {
  const result = await client.evaluate(`(() => {
    const controls = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const outside = controls.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 1 && rect.height > 1 && (rect.left < -1 || rect.right > innerWidth + 1);
    }).map(el => el.getAttribute('aria-label') || el.textContent.trim() || el.className);
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, outside };
  })()`);
  assert.ok(result.scrollWidth <= result.width + 1, `${label}: horizontal document overflow: ${JSON.stringify(result)}`);
  assert.deepEqual(result.outside, [], `${label}: controls exceed the viewport`);
  report.checks.push({ name: label, ...result });
}

async function click(client, selector) {
  assert.equal(await client.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled || el.getBoundingClientRect().width === 0) return false;
    el.click(); return true;
  })()`), true, `Control is missing, hidden or disabled: ${selector}`);
}

async function openFixture(client, fixture = FIXTURE) {
  await click(client, '#open-tab');
  await client.evaluate('document.querySelector("input[type=file]").value = ""');
  const { root } = await client.call('DOM.getDocument');
  const { nodeId } = await client.call('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[type=file]' });
  assert.ok(nodeId, 'Local structure file input is missing');
  await client.call('DOM.setFileInputFiles', { nodeId, files: [fixture] });
  await waitFor(client, `(() => {
    const canvas = document.querySelector('.viewer-host canvas');
    const reset = document.querySelector('.viewer-actions .viewer-button[title="Reset view"]');
    return canvas && canvas.width > 0 && canvas.height > 0 && reset && !reset.hidden && !reset.disabled;
  })()`, 'local structure and Mol* WebGL canvas', 30_000);
  assert.equal(await client.evaluate(`document.querySelector('.error-box')?.hidden`), true, 'Viewer reported a load error');
}

async function checkPng(client, color, name, requireStructure = false) {
  await client.evaluate('delete globalThis.__UI_CHECK_PNG__');
  await click(client, '.image-button');
  await waitFor(client, 'typeof globalThis.__UI_CHECK_PNG__ === "string"', 'actual Mol* PNG export', 30_000);
  const png = await client.evaluate(`(async () => {
    const image = new Image();
    image.src = globalThis.__UI_CHECK_PNG__;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const points = [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]];
    const background = ${color === 'black' ? 0 : 255};
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let foregroundPixels = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 0 && Math.max(
        Math.abs(pixels[i] - background),
        Math.abs(pixels[i + 1] - background),
        Math.abs(pixels[i + 2] - background),
      ) > 20) {
        foregroundPixels++;
      }
    }
    return { width: image.width, height: image.height, corners: points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]), foregroundPixels, data: image.src };
  })()`);
  assert.ok(png.width > 0 && png.height > 0, 'PNG has invalid dimensions');
  for (const pixel of png.corners) {
    assert.deepEqual(pixel, [...Array(3).fill(color === 'black' ? 0 : 255), 255], `${name}: PNG background is not ${color}`);
  }
  if (requireStructure) assert.ok(png.foregroundPixels > 100, `${name}: the exported view contains no visible structure`);
  await writeFile(join(OUTPUT, `${name}.png`), Buffer.from(png.data.split(',')[1], 'base64'));
  report.checks.push({ name, width: png.width, height: png.height, corners: png.corners, foregroundPixels: png.foregroundPixels });
  report.screenshots.push(`${name}.png`);
}

async function checkGro(client, target) {
  await click(client, '#open-tab');
  const formats = await client.evaluate(`({
    accept: document.querySelector('input[type=file]').accept,
    label: document.querySelector('.dropzone').textContent,
  })`);
  assert.ok(formats.accept.split(',').includes('.gro'), 'The local file picker must accept .gro');
  assert.match(formats.label, /GRO/i, 'The supported-format label must mention GRO');
  report.checks.push({ name: `${target}-gro-file-picker`, ...formats });

  await openFixture(client, GRO_FIXTURE);
  await waitFor(client, `[...document.querySelectorAll('.residue-code')].map(el => el.textContent).join('') === 'AGVK'`, 'GRO sequence');
  const residues = await client.evaluate(`[...document.querySelectorAll('.residue-cell')].map(el => ({
    code: el.querySelector('.residue-code').textContent,
    number: el.querySelector('.residue-number').textContent,
    title: el.title,
    disabled: el.disabled,
  }))`);
  assert.deepEqual(residues.map(({ number }) => number), ['41', '42', '43', '44'], 'GRO author residue numbers changed');
  assert.ok(residues.every(({ title, disabled }) => title.startsWith('Chain A') && !disabled), 'GRO observed residues must be selectable on the inferred chain');
  report.checks.push({ name: `${target}-gro-sequence`, residues });
  await checkPng(client, 'black', `${target}-gro-render`, true);

  // Round-trip the actual loaded model through the browser's export control.
  // This verifies nm -> Å and first-frame selection in the complete viewer path.
  await client.evaluate('delete globalThis.__UI_CHECK_STRUCTURE__');
  await click(client, '.download-button');
  await waitFor(client, 'globalThis.__UI_CHECK_STRUCTURE__ !== undefined', 'GRO mmCIF export');
  const exported = await client.evaluate('globalThis.__UI_CHECK_STRUCTURE__');
  assert.match(exported.filename, /^minimal-two-frame\.cif$/, 'GRO export must use a normalized mmCIF filename');
  const parsed = await CIF.parseText(exported.text).run();
  assert.equal(parsed.isError, false, 'GRO export must be valid mmCIF');
  const atoms = parsed.result.blocks[0]?.categories.atom_site;
  assert.ok(atoms, 'GRO export has no atomic coordinates');
  assert.equal(atoms.rowCount, 16, 'The viewer must export one frame, not merge both GRO frames');
  const coordinates = ['Cartn_x', 'Cartn_y', 'Cartn_z'].map(field => atoms.getField(field).float(0));
  assert.deepEqual(coordinates, [10, 20, 30], 'GRO coordinates must be in Å and come from the first frame');
  report.checks.push({ name: `${target}-gro-export`, filename: exported.filename, atomCount: atoms.rowCount, firstAtomAngstrom: coordinates });
  await writeFile(join(OUTPUT, `${target}-gro-export.cif`), exported.text);
  await screenshot(client, `${target}-gro-viewer`);
}

async function setBackground(client, color) {
  await click(client, `[data-background="${color}"]`);
  await waitFor(client, `document.querySelector('[data-background="${color}"]')?.getAttribute('aria-pressed') === 'true'
    && JSON.parse(localStorage.getItem('protpeek-ui-check-storage') || '{}')['protpeek:viewer-background'] === '${color}'`, 'saved background preference');
  await settled(client);
}

async function checkExtension(client, origin, target) {
  await client.call('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await client.call('Page.navigate', { url: `${origin}/sidepanel.html` });
  await waitFor(client, `location.href === ${JSON.stringify(`${origin}/sidepanel.html`)}
    && document.readyState === 'complete' && document.querySelector('#page-tab') !== null`, `${target} Page screen`);
  await client.evaluate('localStorage.removeItem("protpeek-ui-check-storage")');
  await reload(client);
  await waitFor(client, 'document.querySelector("#page-tab")?.getAttribute("aria-selected") === "true"', 'default Page tab');

  for (const theme of ['light', 'dark']) {
    await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    for (const width of [300, 400]) {
      await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const section of ['page', 'open']) {
        await click(client, `#${section}-tab`);
        await layout(client, `${target}-${section}-${theme}-${width}`, '.nav-tab, .scan-button, .identifier-input, .load-button, .dropzone');
        await screenshot(client, `${target}-${section}-${theme}-${width}`);
      }
    }
  }

  await client.call('Emulation.setDeviceMetricsOverride', { width: 400, height: 900, deviceScaleFactor: 1, mobile: false });
  await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await openFixture(client);
  await click(client, '.customization-toggle');
  await waitFor(client, 'document.querySelector("[data-background=white]")?.getAttribute("aria-pressed") === "true"', 'default white background');
  await checkPng(client, 'white', `${target}-export-white`);
  await setBackground(client, 'black');
  await checkPng(client, 'black', `${target}-export-black`);

  // Changing the system theme must not replace the independent canvas choice.
  for (const theme of ['dark', 'light']) {
    await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    await settled(client);
    await checkPng(client, 'black', `${target}-export-black-ui-${theme}`);
    for (const width of [300, 400]) {
      await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await layout(client, `${target}-viewer-${theme}-${width}`, '.nav-tab, .viewer-actions button, .structure-modes select, .view-background-choice, .selection-editor input, .selection-editor select');
      await screenshot(client, `${target}-viewer-${theme}-${width}`);
    }
  }
  await click(client, '.viewer-actions .viewer-button[title="Reset view"]');
  await checkPng(client, 'black', `${target}-export-after-reset`);
  // Loading another local structure must retain the selected background.
  await openFixture(client, join(ROOT, 'tests/fixtures/minimal.cif'));
  await checkPng(client, 'black', `${target}-export-after-reload-structure`);
  // Browser-local preference survives a fresh document as well.
  await reload(client);
  await openFixture(client);
  await checkPng(client, 'black', `${target}-export-after-panel-reopen`);
  await checkGro(client, target);
}

async function checkDocs(client, origin) {
  for (const path of ['/', '/privacy/']) {
    await client.call('Page.navigate', { url: `${origin}${path}` });
    await waitFor(client, `location.href === ${JSON.stringify(`${origin}${path}`)}
      && document.querySelector('h1') !== null && document.readyState === 'complete'`, path);
    for (const theme of ['light', 'dark']) {
      await client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      for (const width of [300, 400]) {
        await client.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        const name = `docs-${path.includes('privacy') ? 'privacy' : 'home'}-${theme}-${width}`;
        await layout(client, name, 'header a');
        await screenshot(client, name);
      }
    }
  }
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

await mkdir(OUTPUT, { recursive: true });
let chrome;
let profile;
const servers = [];
let client;
let stderr = '';
try {
  const executable = await chromePath();
  await Promise.all(['chrome-mv3', 'firefox-mv3'].map(target => access(join(ROOT, '.output', target, 'sidepanel.html'))));
  const origins = {};
  for (const [name, root] of [['chrome-mv3', '.output/chrome-mv3'], ['firefox-mv3', '.output/firefox-mv3'], ['docs', 'docs']]) {
    const { server, origin } = await serve(join(ROOT, root));
    servers.push(server);
    origins[name] = origin;
  }
  profile = await mkdtemp(join(tmpdir(), 'protpeek-ui-check-'));
  chrome = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run',
    '--no-default-browser-check', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.stderr.on('data', data => { stderr += data.toString(); });
  let port;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  assert.ok(port, `Chrome did not start: ${stderr.slice(-2000)}`);
  const targets = await (await globalThis.fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'Chrome has no debuggable page');
  client = await Cdp.connect(page.webSocketDebuggerUrl);
  await client.call('Page.enable');
  await client.call('Runtime.enable');
  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => report.exceptions.push(exceptionDetails.exception?.description ?? exceptionDetails.text));
  await client.call('Page.addScriptToEvaluateOnNewDocument', { source: extensionStub });
  for (const target of ['chrome-mv3', 'firefox-mv3']) await checkExtension(client, origins[target], target);
  await checkDocs(client, origins.docs);
  assert.deepEqual(report.exceptions, [], 'Uncaught browser JavaScript exceptions');
  report.passed = true;
  process.stdout.write(`Browser UI check passed: ${report.checks.length} assertions, ${report.screenshots.length} images.\n`);
} catch (error) {
  report.passed = false;
  report.error = error.stack ?? String(error);
  if (client) {
    try { await screenshot(client, 'failure'); } catch { /* Keep the original failure. */ }
  }
  process.stderr.write(`${report.error}\n`);
  process.exitCode = 1;
} finally {
  await writeFile(join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  client?.close();
  chrome?.kill();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
