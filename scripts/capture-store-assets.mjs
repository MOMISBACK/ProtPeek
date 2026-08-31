// SPDX-License-Identifier: MPL-2.0
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT = resolve(import.meta.dirname, '..');
const OUTPUT_DIRECTORY = resolve(ROOT, '.output');
const STORE_ASSET_DIRECTORY = resolve(ROOT, 'store-assets');
const PUBLIC_DIRECTORY = resolve(ROOT, 'public');
const EXTENSION_ID = 'protpeek@momisback.github.io';
const EXTENSION_UUID = '7f4d8c35-7dc4-4f5f-a9c8-87df97dc6e50';
const STRUCTURE_ID = '1AON';
const ICON_SOURCE_SIZE = 512;
const ICON_SIZES = [16, 32, 48, 96, 128];
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function log(message) {
  process.stdout.write(`[ProtPeek assets] ${message}\n`);
}

async function latestFirefoxArchive() {
  const requested = process.argv[2];
  if (requested !== undefined) return resolve(requested);

  const entries = await readdir(OUTPUT_DIRECTORY, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          /^protpeek-.*-firefox\.(?:zip|xpi)$/u.test(entry.name),
      )
      .map(async (entry) => {
        const path = resolve(OUTPUT_DIRECTORY, entry.name);
        return { path, modified: (await stat(path)).mtimeMs };
      }),
  );
  candidates.sort((left, right) => right.modified - left.modified);
  if (candidates[0] === undefined) {
    throw new Error(
      'No Firefox archive found. Run `npm run zip:firefox` first, or pass its path.',
    );
  }
  return candidates[0].path;
}

function firefoxBinary() {
  const requested = process.env.PROTPEEK_FIREFOX_BINARY;
  if (requested !== undefined) return requested;
  const candidates = [
    '/Applications/Firefox.app/Contents/MacOS/firefox',
    '/usr/bin/firefox',
    '/usr/local/bin/firefox',
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found === undefined) {
    throw new Error(
      'Firefox was not found. Set PROTPEEK_FIREFOX_BINARY to its executable.',
    );
  }
  return found;
}

async function availablePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate a WebDriver port'));
        return;
      }
      server.close((error) => {
        if (error === undefined) resolvePort(address.port);
        else reject(error);
      });
    });
  });
}

async function waitForDriver(baseUrl, driver, driverLog) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (driver.exitCode !== null) {
      throw new Error(
        `geckodriver exited before it became ready.\n${driverLog.join('')}`,
      );
    }
    try {
      const response = await globalThis.fetch(`${baseUrl}/status`);
      if (response.ok) return;
    } catch {
      // geckodriver is still starting.
    }
    await delay(100);
  }
  throw new Error(`geckodriver did not become ready.\n${driverLog.join('')}`);
}

function webdriver(baseUrl, sessionId) {
  return async (method, endpoint, body) => {
    const response = await globalThis.fetch(
      `${baseUrl}${sessionId === undefined ? '' : `/session/${sessionId}`}${endpoint}`,
      {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload.value?.message ?? JSON.stringify(payload);
      throw new Error(`${method} ${endpoint} failed: ${detail}`);
    }
    return payload.value;
  };
}

async function execute(call, script, args = []) {
  return await call('POST', '/execute/sync', { script, args });
}

async function executeAsync(call, script, args = []) {
  return await call('POST', '/execute/async', { script, args });
}

async function openExtensionPage(call, url) {
  try {
    await call('POST', '/url', { url });
    return;
  } catch (navigationError) {
    // Firefox blocks a WebDriver content context from initiating a privileged
    // moz-extension: navigation. Use the browser's chrome context solely to
    // open the already installed extension page, then return to content.
    try {
      await call('POST', '/moz/context', { context: 'chrome' });
      await execute(
        call,
        `
          const [url] = arguments;
          const principal = Services.scriptSecurityManager.getSystemPrincipal();
          const tab = gBrowser.addTab(url, { triggeringPrincipal: principal });
          gBrowser.selectedTab = tab;
        `,
        [url],
      );
      await call('POST', '/moz/context', { context: 'content' });
      await delay(500);
      const currentUrl = await call('GET', '/url');
      if (currentUrl !== url) {
        throw new Error(`Firefox opened ${currentUrl} instead of ${url}`, {
          cause: navigationError,
        });
      }
    } catch (fallbackError) {
      throw new AggregateError(
        [navigationError, fallbackError],
        'Firefox could not open the temporarily installed extension page',
        { cause: fallbackError },
      );
    }
  }
}

async function setViewport(call, width, height) {
  let outerWidth = width;
  let outerHeight = height;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await call('POST', '/window/rect', {
      height: Math.max(100, Math.round(outerHeight)),
      width: Math.max(100, Math.round(outerWidth)),
      x: 0,
      y: 0,
    });
    const inner = await execute(
      call,
      'return { height: window.innerHeight, width: window.innerWidth };',
    );
    if (inner.width === width && inner.height === height) return;
    outerWidth += width - inner.width;
    outerHeight += height - inner.height;
  }
  const inner = await execute(
    call,
    'return { height: window.innerHeight, width: window.innerWidth };',
  );
  throw new Error(
    `Could not set an exact ${width}x${height} viewport (got ${inner.width}x${inner.height})`,
  );
}

async function waitForStructure(call) {
  const startedAt = Date.now();
  let lastReport = 0;
  while (Date.now() - startedAt < 300_000) {
    const state = await execute(
      call,
      `
        const error = document.querySelector('.error-box');
        const download = document.querySelector('.download-button');
        return {
          canvasCount: document.querySelectorAll('.viewer-host canvas').length,
          chains: document.querySelectorAll('.chain-list .chain-chip').length,
          chainLabels: [...document.querySelectorAll('.chain-list .chain-chip')]
            .slice(0, 5)
            .map((node) => node.textContent),
          downloadReady: download !== null && !download.hidden && !download.disabled,
          error: error !== null && !error.hidden ? error.textContent.trim() : '',
          molstarLoaded: performance.getEntriesByType('resource')
            .some((entry) => entry.name.includes('MolstarViewer')),
          rcsb: performance.getEntriesByType('resource')
            .filter((entry) => entry.name.includes('rcsb.org'))
            .map((entry) => ({
              duration: Math.round(entry.duration),
              name: entry.name,
              transferSize: entry.transferSize,
            })),
          status: document.querySelector('.load-status')?.textContent?.trim() ?? '',
        };
      `,
    );
    if (state.error !== '') {
      throw new Error(`ProtPeek could not load ${STRUCTURE_ID}: ${state.error}`);
    }
    if (state.downloadReady && state.canvasCount > 0 && state.chains > 0) {
      return state;
    }
    const elapsed = Date.now() - startedAt;
    if (elapsed - lastReport >= 15_000) {
      lastReport = elapsed;
      log(
        `still loading after ${Math.round(elapsed / 1_000)}s ` +
          `(Mol* ${state.molstarLoaded ? 'loaded' : 'not loaded'}, ` +
          `${state.canvasCount} canvas, RCSB ${JSON.stringify(state.rcsb)})`,
      );
    }
    await delay(1_000);
  }
  throw new Error(`Timed out while ProtPeek loaded ${STRUCTURE_ID}`);
}

async function inclineStructure(call) {
  const rect = await execute(
    call,
    `
      const rect = document.querySelector('.viewer-host canvas')?.getBoundingClientRect();
      return rect === undefined ? null : {
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      };
    `,
  );
  if (rect === null) throw new Error('Mol* canvas is missing');
  const startX = Math.round(rect.left + rect.width * 0.48);
  const startY = Math.round(rect.top + rect.height * 0.5);
  await call('POST', '/actions', {
    actions: [
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 0,
            origin: 'viewport',
            x: startX,
            y: startY,
          },
          { type: 'pointerDown', button: 0 },
          {
            type: 'pointerMove',
            duration: 650,
            origin: 'viewport',
            x: Math.round(startX + rect.width * 0.1),
            y: Math.round(startY - rect.height * 0.075),
          },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await call('DELETE', '/actions');
  await delay(800);
}

async function inspectStoreLayout(call) {
  const layout = await execute(
    call,
    `
      const strip = document.querySelector('.entity-strip');
      if (strip instanceof HTMLElement) strip.scrollLeft = 0;
      const chip = document.querySelector('.chain-chip');
      const visibility = document.querySelector('.chain-visibility');
      const describe = (node) => {
        if (!(node instanceof HTMLElement)) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          bottom: Math.round(rect.bottom),
          color: style.color,
          display: style.display,
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          opacity: style.opacity,
          position: style.position,
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          visibility: style.visibility,
          width: Math.round(rect.width),
          zIndex: style.zIndex,
        };
      };
      const chipRect = chip?.getBoundingClientRect();
      const covering = chipRect === undefined
        ? null
        : document.elementFromPoint(
            chipRect.left + chipRect.width / 2,
            chipRect.top + chipRect.height / 2,
          );
      return {
        app: describe(document.querySelector('.protpeek-app')),
        chip: describe(chip),
        covering: covering instanceof HTMLElement
          ? { className: covering.className, tagName: covering.tagName }
          : null,
        inspector: describe(document.querySelector('.inspector')),
        scrollLeft: strip instanceof HTMLElement ? strip.scrollLeft : null,
        strip: describe(strip),
        viewer: describe(document.querySelector('.viewer-frame')),
        visibility: describe(visibility),
      };
    `,
  );
  log(`store layout ${JSON.stringify(layout)}`);
  if (
    layout.scrollLeft !== 0 ||
    layout.covering?.tagName !== 'BUTTON' ||
    !String(layout.covering.className).split(/\s+/u).includes('chain-chip') ||
    layout.viewer === null ||
    layout.strip === null ||
    layout.viewer.bottom > layout.strip.top
  ) {
    throw new Error(
      'The 640x400 layout obscures chain labels; refusing to capture a broken store asset',
    );
  }
  return layout;
}

async function waitForControlState(
  call,
  { focus, isolate, selection },
  timeoutMs = 120_000,
) {
  await delay(150);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const state = await execute(
      call,
      `
        const error = document.querySelector('.error-box');
        return {
          error: error !== null && !error.hidden ? error.textContent.trim() : '',
          focus: document.querySelector('.selection-actions .text-button')
            ?.getAttribute('aria-pressed'),
          isolate: [...document.querySelectorAll('.selection-actions .text-button')]
            .find((node) => node.textContent === 'Isolate')
            ?.getAttribute('aria-pressed'),
          selection: document.querySelector('.selected-label')?.textContent?.trim(),
          status: document.querySelector('.load-status')?.textContent?.trim() ?? '',
        };
      `,
    );
    if (state.error !== '') throw new Error(`1AON interaction smoke failed: ${state.error}`);
    const matches =
      (focus === undefined || state.focus === String(focus)) &&
      (isolate === undefined || state.isolate === String(isolate)) &&
      (selection === undefined || state.selection === selection);
    if (matches && state.status === '') return;
    await delay(250);
  }
  throw new Error('Timed out while restoring the 1AON interaction smoke state');
}

async function clickBlankViewer(call) {
  const point = await execute(
    call,
    `
      const rect = document.querySelector('.viewer-host canvas')?.getBoundingClientRect();
      return rect === undefined ? null : {
        x: Math.round(rect.left + rect.width * 0.05),
        y: Math.round(rect.top + rect.height * 0.08),
      };
    `,
  );
  if (point === null) throw new Error('Mol* canvas is missing');
  await call('POST', '/actions', {
    actions: [
      {
        type: 'pointer',
        id: 'smoke-mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          {
            type: 'pointerMove',
            duration: 0,
            origin: 'viewport',
            x: point.x,
            y: point.y,
          },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ],
  });
  await call('DELETE', '/actions');
}

async function smokeInteractions(call) {
  await execute(call, "document.querySelector('.chain-chip')?.click();");
  await waitForControlState(call, { focus: true, isolate: false });

  await execute(
    call,
    `
      [...document.querySelectorAll('.selection-actions .text-button')]
        .find((node) => node.textContent === 'Focus')?.click();
    `,
  );
  await waitForControlState(call, { focus: false, isolate: false });
  await execute(
    call,
    `
      [...document.querySelectorAll('.selection-actions .text-button')]
        .find((node) => node.textContent === 'Focus')?.click();
    `,
  );
  await waitForControlState(call, { focus: true, isolate: false });

  await execute(
    call,
    `
      [...document.querySelectorAll('.selection-actions .text-button')]
        .find((node) => node.textContent === 'Isolate')?.click();
    `,
  );
  await waitForControlState(call, { focus: true, isolate: true });
  await execute(
    call,
    `
      [...document.querySelectorAll('.selection-actions .text-button')]
        .find((node) => node.textContent === 'Isolate')?.click();
    `,
  );
  await waitForControlState(call, { focus: false, isolate: false });

  await clickBlankViewer(call);
  await waitForControlState(call, {
    focus: false,
    isolate: false,
    selection: 'No selection',
  });
  await execute(call, "document.querySelector('[title=\"Reset view\"]')?.click();");
  await delay(500);
  log('1AON interaction smoke passed and restored');
}

async function captureViewport(call, path) {
  const screenshot = await call('GET', '/screenshot');
  await writeFile(path, Buffer.from(screenshot, 'base64'));
}

async function renderPngInFirefox(call, source, size, crop = null) {
  return await executeAsync(
    call,
    `
      const [encoded, size, requestedCrop, done] = arguments;
      void (async () => {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { alpha: true });
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        if (requestedCrop === null) {
          context.drawImage(bitmap, 0, 0, size, size);
        } else {
          context.drawImage(
            bitmap,
            requestedCrop.x,
            requestedCrop.y,
            requestedCrop.size,
            requestedCrop.size,
            0,
            0,
            size,
            size,
          );
        }
        bitmap.close();
        const dataUrl = canvas.toDataURL('image/png');
        return dataUrl.slice(dataUrl.indexOf(',') + 1);
      })().then(done, (error) => done({ error: String(error?.stack ?? error) }));
    `,
    [source.toString('base64'), size, crop],
  );
}

async function moleculeCropInFirefox(call, source) {
  return await executeAsync(
    call,
    `
      const [encoded, done] = arguments;
      void (async () => {
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { alpha: true });
        context.drawImage(bitmap, 0, 0);
        bitmap.close();
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const [backgroundRed, backgroundGreen, backgroundBlue] = pixels.data;
        let minimumX = canvas.width;
        let minimumY = canvas.height;
        let maximumX = -1;
        let maximumY = -1;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            // Mol* draws its orientation helper in the lower-left corner. It
            // is UI chrome, not molecular geometry, so exclude that region
            // from both detection and the final molecule-only crop.
            if (x < canvas.width * 0.17 && y > canvas.height * 0.7) continue;
            const offset = (y * canvas.width + x) * 4;
            const difference =
              Math.abs(pixels.data[offset] - backgroundRed) +
              Math.abs(pixels.data[offset + 1] - backgroundGreen) +
              Math.abs(pixels.data[offset + 2] - backgroundBlue);
            if (pixels.data[offset + 3] === 0 || difference < 30) continue;
            minimumX = Math.min(minimumX, x);
            minimumY = Math.min(minimumY, y);
            maximumX = Math.max(maximumX, x);
            maximumY = Math.max(maximumY, y);
          }
        }
        if (maximumX < minimumX || maximumY < minimumY) {
          throw new Error('No molecular pixels were found in the Mol* capture');
        }
        const moleculeWidth = maximumX - minimumX + 1;
        const moleculeHeight = maximumY - minimumY + 1;
        const cropSize = Math.min(
          canvas.width,
          Math.ceil(Math.max(moleculeWidth, moleculeHeight) * 1.075),
        );
        const centerX = (minimumX + maximumX) / 2;
        const centerY = (minimumY + maximumY) / 2;
        const x = Math.max(0, Math.min(canvas.width - cropSize, Math.round(centerX - cropSize / 2)));
        const y = Math.max(0, Math.min(canvas.height - cropSize, Math.round(centerY - cropSize / 2)));
        return { size: cropSize, x, y };
      })().then(done, (error) => done({ error: String(error?.stack ?? error) }));
    `,
    [source.toString('base64')],
  );
}

function pngDimensions(buffer, label) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a valid PNG signature`);
  }
  if (buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${label} has no valid PNG IHDR`);
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function verifyPng(path, expectedWidth, expectedHeight) {
  const buffer = await readFile(path);
  const dimensions = pngDimensions(buffer, path);
  if (
    dimensions.width !== expectedWidth ||
    dimensions.height !== expectedHeight
  ) {
    throw new Error(
      `${path} is ${dimensions.width}x${dimensions.height}; expected ${expectedWidth}x${expectedHeight}`,
    );
  }
  log(`verified ${path.slice(ROOT.length + 1)} (${expectedWidth}x${expectedHeight})`);
}

async function main() {
  const archive = await latestFirefoxArchive();
  if (!existsSync(archive)) throw new Error(`Firefox archive not found: ${archive}`);
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const driverLog = [];
  const driver = spawn(
    process.env.PROTPEEK_GECKODRIVER ?? 'geckodriver',
    ['--host', '127.0.0.1', '--port', String(port), '--log', 'error'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  driver.stdout.on('data', (chunk) => driverLog.push(String(chunk)));
  driver.stderr.on('data', (chunk) => driverLog.push(String(chunk)));

  let sessionId;
  try {
    await waitForDriver(baseUrl, driver, driverLog);
    const rootCall = webdriver(baseUrl);
    const session = await rootCall('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          'moz:firefoxOptions': {
            binary: firefoxBinary(),
            args: ['-headless', '-remote-allow-system-access'],
            prefs: {
              'browser.shell.checkDefaultBrowser': false,
              'browser.startup.page': 0,
              'extensions.webextensions.uuids': JSON.stringify({
                [EXTENSION_ID]: EXTENSION_UUID,
              }),
              'layout.css.devPixelsPerPx': '1.0',
              'layout.css.prefers-color-scheme.content-override': 1,
              'ui.systemUsesDarkTheme': 0,
            },
          },
        },
      },
    });
    sessionId = session.sessionId;
    if (typeof sessionId !== 'string') throw new Error('WebDriver returned no session ID');
    const call = webdriver(baseUrl, sessionId);
    await call('POST', '/moz/addon/install', {
      path: archive,
      temporary: true,
    });
    log(`installed ${archive.slice(ROOT.length + 1)} temporarily`);

    await setViewport(call, 640, 400);
    await openExtensionPage(
      call,
      `moz-extension://${EXTENSION_UUID}/sidepanel.html`,
    );
    await execute(
      call,
      `
        const input = document.querySelector('.identifier-input');
        if (!(input instanceof HTMLInputElement)) throw new Error('Identifier input missing');
        input.value = '${STRUCTURE_ID}';
        document.querySelector('.identifier-form')?.requestSubmit();
      `,
    );
    log(`loading RCSB ${STRUCTURE_ID} through the real ProtPeek UI…`);
    const loaded = await waitForStructure(call);
    log(
      `loaded ${STRUCTURE_ID} (${loaded.chains} chain controls: ` +
        `${loaded.chainLabels.join(', ')}${loaded.chains > 5 ? ', …' : ''})`,
    );
    await inspectStoreLayout(call);

    await execute(
      call,
      `
        const color = document.querySelector('select[aria-label="Structure color"]');
        if (color instanceof HTMLSelectElement) {
          color.value = 'uniform';
          color.dispatchEvent(new Event('change', { bubbles: true }));
        }
      `,
    );
    await delay(1_500);
    await inclineStructure(call);
    const storeScreenshot = resolve(
      STORE_ASSET_DIRECTORY,
      'protpeek-640x400.png',
    );
    await mkdir(STORE_ASSET_DIRECTORY, { recursive: true });
    await captureViewport(call, storeScreenshot);
    await verifyPng(storeScreenshot, 640, 400);
    await smokeInteractions(call);

    await setViewport(call, ICON_SOURCE_SIZE, ICON_SOURCE_SIZE);
    await execute(
      call,
      `
        for (const selector of [
          '.topbar',
          '.article-bar',
          '.entity-strip',
          '.inspector',
          '.viewer-actions',
          '.status-line',
          '.error-box',
          '.hover-label',
          '.drop-overlay',
          '.empty-state',
        ]) {
          const node = document.querySelector(selector);
          if (node instanceof HTMLElement) node.style.display = 'none';
        }
        const app = document.querySelector('.protpeek-app');
        const frame = document.querySelector('.viewer-frame');
        if (!(app instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
          throw new Error('Viewer frame is missing');
        }
        Object.assign(app.style, {
          display: 'block',
          height: '${ICON_SOURCE_SIZE}px',
          minHeight: '0',
          width: '${ICON_SOURCE_SIZE}px',
        });
        Object.assign(frame.style, {
          height: '${ICON_SOURCE_SIZE}px',
          inset: '0',
          minHeight: '0',
          position: 'fixed',
          width: '${ICON_SOURCE_SIZE}px',
        });
        window.dispatchEvent(new Event('resize'));
      `,
    );
    await delay(1_000);
    await inclineStructure(call);
    const rawSource = Buffer.from(await call('GET', '/screenshot'), 'base64');
    const crop = await moleculeCropInFirefox(call, rawSource);
    if (
      typeof crop !== 'object' ||
      crop === null ||
      typeof crop.size !== 'number'
    ) {
      throw new Error(`Firefox could not locate the molecule crop: ${crop.error}`);
    }
    log(`molecule crop ${crop.size}x${crop.size} at ${crop.x},${crop.y}`);
    const cropped = await renderPngInFirefox(
      call,
      rawSource,
      ICON_SOURCE_SIZE,
      crop,
    );
    if (typeof cropped !== 'string') {
      throw new Error(`Firefox could not crop the molecule: ${cropped.error}`);
    }
    const source = Buffer.from(cropped, 'base64');
    const sourcePath = resolve(
      STORE_ASSET_DIRECTORY,
      `protpeek-${STRUCTURE_ID.toLowerCase()}-${ICON_SOURCE_SIZE}.png`,
    );
    await writeFile(sourcePath, source);
    await verifyPng(sourcePath, ICON_SOURCE_SIZE, ICON_SOURCE_SIZE);

    await mkdir(PUBLIC_DIRECTORY, { recursive: true });
    for (const size of ICON_SIZES) {
      const resized = await renderPngInFirefox(call, source, size);
      if (typeof resized !== 'string') {
        throw new Error(`Firefox could not resize the ${size}px icon: ${resized.error}`);
      }
      const buffer = Buffer.from(resized, 'base64');
      const publicPath = resolve(PUBLIC_DIRECTORY, `icon-${size}.png`);
      await writeFile(publicPath, buffer);
      await verifyPng(publicPath, size, size);
      if (size === 128) {
        const storeIcon = resolve(
          STORE_ASSET_DIRECTORY,
          'protpeek-icon-128.png',
        );
        await writeFile(storeIcon, buffer);
        await verifyPng(storeIcon, 128, 128);
      }
    }
  } finally {
    if (sessionId !== undefined) {
      try {
        await webdriver(baseUrl, sessionId)('DELETE', '');
      } catch {
        // Firefox may already have exited.
      }
    }
    if (driver.exitCode === null) driver.kill('SIGTERM');
  }
}

await main();
