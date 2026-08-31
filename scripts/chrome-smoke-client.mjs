// SPDX-License-Identifier: MPL-2.0
const [targetUrl, fixturePath, remoteIdentifier] = process.argv.slice(2);

if (targetUrl === undefined || fixturePath === undefined) {
  process.stderr.write(
    'Usage: node scripts/chrome-smoke-client.mjs <CDP websocket URL> <fixture path>\n',
  );
  process.exit(2);
}

const socket = new globalThis.WebSocket(targetUrl);
const pending = new Map();
let requestId = 0;

socket.onmessage = (event) => {
  const message = JSON.parse(String(event.data));
  const request = pending.get(message.id);
  if (request === undefined) return;
  pending.delete(message.id);
  if (message.error === undefined) request.resolve(message.result);
  else request.reject(new Error(message.error.message));
};

await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, { reject, resolve });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const response = await call('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (response.exceptionDetails !== undefined) {
    throw new Error(response.exceptionDetails.text);
  }
  return response.result.value;
}

async function pause(durationMs) {
  await new Promise((resolve) => globalThis.setTimeout(resolve, durationMs));
}

await call('Runtime.enable');
await call('DOM.enable');
await call('Page.bringToFront');
await call('Emulation.setDeviceMetricsOverride', {
  deviceScaleFactor: 2,
  height: 700,
  mobile: false,
  width: 320,
});
await pause(400);

const initial = await evaluate(`(() => ({
  bodyHeight: document.body.scrollHeight,
  bodyWidth: document.body.scrollWidth,
  brand: document.querySelector('.brand')?.textContent,
  canvasCount: document.querySelectorAll('canvas').length,
  chooseFile: document.querySelector('.empty-file-button')?.textContent,
  empty: document.querySelector('.empty-title')?.textContent,
  molstarLoaded: performance.getEntriesByType('resource')
    .some((entry) => entry.name.includes('MolstarViewer')),
  placeholder: document.querySelector('.identifier-input')?.getAttribute('placeholder'),
  ready: document.readyState,
  viewportHeight: document.documentElement.clientHeight,
  viewportWidth: document.documentElement.clientWidth,
}))()`);

const documentNode = await call('DOM.getDocument', { depth: -1 });
const inputNode = await call('DOM.querySelector', {
  nodeId: documentNode.root.nodeId,
  selector: 'input[type="file"]',
});
if (inputNode.nodeId === 0) throw new Error('ProtPeek file input is missing');
const localStartedAt = globalThis.performance.now();
await call('DOM.setFileInputFiles', {
  files: [fixturePath],
  nodeId: inputNode.nodeId,
});
await evaluate(`(() => {
  const input = document.querySelector('input[type="file"]');
  input?.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
const initialLoading = await evaluate(`(() => ({
  emptyHidden: document.querySelector('.empty-state')?.hidden,
  status: document.querySelector('.load-status')?.textContent,
}))()`);

let loaded;
for (let attempt = 0; attempt < 80; attempt += 1) {
  loaded = await evaluate(`(() => ({
    canvasCount: document.querySelectorAll('canvas').length,
    chains: [...document.querySelectorAll('.chain-list .entity-chip')]
      .map((node) => node.textContent),
    errorHidden: document.querySelector('.error-box')?.hidden,
    errorText: document.querySelector('.error-box')?.textContent?.trim(),
    ligands: [...document.querySelectorAll('.ligand-list .entity-chip')]
      .map((node) => node.textContent),
    layout: Object.fromEntries([
      '.topbar',
      '.viewer-frame',
      '.entity-strip',
      '.inspector',
      '.structure-controls',
      '.selection-editor',
      '.sequence-scroll',
    ].map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      return [selector, rect === undefined ? null : {
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
      }];
    })),
    molstarLoaded: performance.getEntriesByType('resource')
      .some((entry) => entry.name.includes('MolstarViewer')),
    downloadAriaLabel: document.querySelector('.download-button')
      ?.getAttribute('aria-label'),
    downloadDisabled: document.querySelector('.download-button')?.disabled,
    downloadHidden: document.querySelector('.download-button')?.hidden,
    resetHidden: document.querySelector(
      '.viewer-actions .viewer-button:not(.download-button)',
    )?.hidden,
    sequenceCells: document.querySelectorAll('.residue-cell').length,
  }))()`);
  if (
    loaded.errorHidden === false ||
    (loaded.downloadHidden === false && loaded.resetHidden === false)
  ) {
    break;
  }
  await pause(200);
}
const localElapsedMs = Number((globalThis.performance.now() - localStartedAt).toFixed(1));

const localTiming = await evaluate(`globalThis.__PROTPEEK_LAST_TIMINGS__ ?? null`);
let frameSample = null;
const benchmarkAvailable = await evaluate(
  `typeof globalThis.__PROTPEEK_BENCHMARK__?.sampleFps === 'function'`,
);
if (benchmarkAvailable) {
  const sampling = evaluate(
    `globalThis.__PROTPEEK_BENCHMARK__.sampleFps(1500)`,
  );
  await call('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    type: 'mousePressed',
    x: 120,
    y: 210,
  });
  for (let step = 0; step < 80; step += 1) {
    await call('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      type: 'mouseMoved',
      x: 120 + (step % 40) * 2,
      y: 210 + Math.round(Math.sin(step / 5) * 25),
    });
    await pause(16);
  }
  await call('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    type: 'mouseReleased',
    x: 198,
    y: 210,
  });
  frameSample = await sampling;
}

let operations = {};
if (loaded?.errorHidden !== false) {
  const controls = await evaluate(`(() => {
    const selectionRepresentation = document.querySelector(
      'select[aria-label="Selected residues representation"]',
    );
    return {
      chainLabel: document.querySelector('.chain-list .chain-chip')?.textContent,
      downloadAriaLabel: document.querySelector('.download-button')
        ?.getAttribute('aria-label'),
      downloadDisabled: document.querySelector('.download-button')?.disabled,
      downloadHidden: document.querySelector('.download-button')?.hidden,
      focusDisabled: [...document.querySelectorAll('.selection-actions button')]
        .find((node) => node.textContent === 'Focus')?.disabled,
      selectionRepresentationDisabled: selectionRepresentation?.disabled,
      selectionRepresentationOptions: [...(selectionRepresentation?.options ?? [])]
        .map((option) => ({ label: option.textContent, value: option.value })),
    };
  })()`);

  await evaluate(`(() => {
    document.querySelector('.chain-list .chain-chip')?.click();
  })()`);
  await pause(300);
  const afterChainSelect = await evaluate(`(() => {
    const focus = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus');
    return {
      focusActive: focus?.classList.contains('is-active'),
      focusPressed: focus?.getAttribute('aria-pressed'),
      selected: document.querySelector('.selected-label')?.textContent,
    };
  })()`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus')?.click();
  })()`);
  await pause(300);
  const afterFocusOff = await evaluate(`(() => {
    const focus = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus');
    return {
      active: focus?.classList.contains('is-active'),
      pressed: focus?.getAttribute('aria-pressed'),
    };
  })()`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus')?.click();
  })()`);
  await pause(300);
  const afterFocusOn = await evaluate(`(() => {
    const focus = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus');
    return {
      active: focus?.classList.contains('is-active'),
      pressed: focus?.getAttribute('aria-pressed'),
    };
  })()`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate')?.click();
  })()`);
  await pause(500);
  const afterIsolateOn = await evaluate(`(() => {
    const isolate = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate');
    const showAll = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all');
    return {
      active: isolate?.classList.contains('is-active'),
      errorHidden: document.querySelector('.error-box')?.hidden,
      pressed: isolate?.getAttribute('aria-pressed'),
      showAllHidden: showAll?.hidden,
    };
  })()`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate')?.click();
  })()`);
  await pause(500);
  const afterIsolateOff = await evaluate(`(() => {
    const focus = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus');
    const isolate = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate');
    const showAll = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all');
    return {
      active: isolate?.classList.contains('is-active'),
      errorHidden: document.querySelector('.error-box')?.hidden,
      focusPressed: focus?.getAttribute('aria-pressed'),
      pressed: isolate?.getAttribute('aria-pressed'),
      showAllHidden: showAll?.hidden,
    };
  })()`);

  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate')?.click();
  })()`);
  await pause(500);
  await evaluate(`(() => {
    [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all')?.click();
  })()`);
  await pause(500);
  const afterShowAll = await evaluate(`(() => {
    const focus = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Focus');
    const isolate = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Isolate');
    const showAll = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all');
    return {
      errorHidden: document.querySelector('.error-box')?.hidden,
      focusPressed: focus?.getAttribute('aria-pressed'),
      isolatePressed: isolate?.getAttribute('aria-pressed'),
      showAllHidden: showAll?.hidden,
    };
  })()`);

  await evaluate(`document.querySelector('.chain-visibility')?.click()`);
  await pause(500);
  const afterHide = await evaluate(`(() => {
    const showAll = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all');
    const visibility = document.querySelector('.chain-visibility');
    return {
      active: visibility?.classList.contains('is-active'),
      ariaLabel: visibility?.getAttribute('aria-label'),
      errorHidden: document.querySelector('.error-box')?.hidden,
      pressed: visibility?.getAttribute('aria-pressed'),
      showAllHidden: showAll?.hidden,
    };
  })()`);

  await evaluate(`document.querySelector('.chain-visibility')?.click()`);
  await pause(500);
  const afterShow = await evaluate(`(() => {
    const showAll = [...document.querySelectorAll('.selection-actions button')]
      .find((node) => node.textContent === 'Show all');
    const visibility = document.querySelector('.chain-visibility');
    return {
      active: visibility?.classList.contains('is-active'),
      ariaLabel: visibility?.getAttribute('aria-label'),
      errorHidden: document.querySelector('.error-box')?.hidden,
      pressed: visibility?.getAttribute('aria-pressed'),
      showAllHidden: showAll?.hidden,
    };
  })()`);

  await evaluate(`(() => {
    const representation = document.querySelector(
      'select[aria-label="Structure representation"]',
    );
    if (representation instanceof HTMLSelectElement) {
      representation.value = 'surface';
      representation.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await pause(1_000);
  const afterSurface = await evaluate(`(() => ({
    errorHidden: document.querySelector('.error-box')?.hidden,
    errorText: document.querySelector('.error-box')?.textContent?.trim(),
    status: document.querySelector('.load-status')?.textContent,
  }))()`);
  await evaluate(`(() => {
    const representation = document.querySelector(
      'select[aria-label="Structure representation"]',
    );
    if (representation instanceof HTMLSelectElement) {
      representation.value = 'cartoon';
      representation.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const input = document.querySelector('.selection-input');
    if (input instanceof HTMLInputElement) input.value = 'A:5';
    document.querySelector('.primary-small')?.click();
  })()`);
  await pause(300);
  const selectionStyleInitial = await evaluate(`(() => {
    const select = document.querySelector(
      'select[aria-label="Selected residues representation"]',
    );
    return {
      disabled: select?.disabled,
      selected: document.querySelector('.selected-label')?.textContent,
      value: select?.value,
    };
  })()`);

  await evaluate(`(() => {
    const select = document.querySelector(
      'select[aria-label="Selected residues representation"]',
    );
    if (select instanceof HTMLSelectElement) {
      select.value = 'sticks';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await pause(500);
  const afterSticks = await evaluate(`(() => ({
    errorHidden: document.querySelector('.error-box')?.hidden,
    value: document.querySelector(
      'select[aria-label="Selected residues representation"]',
    )?.value,
  }))()`);

  await evaluate(`(() => {
    const select = document.querySelector(
      'select[aria-label="Selected residues representation"]',
    );
    if (select instanceof HTMLSelectElement) {
      select.value = 'ball-and-stick';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await pause(500);
  const afterBallAndStick = await evaluate(`(() => ({
    errorHidden: document.querySelector('.error-box')?.hidden,
    value: document.querySelector(
      'select[aria-label="Selected residues representation"]',
    )?.value,
  }))()`);

  await evaluate(`(() => {
    const select = document.querySelector(
      'select[aria-label="Selected residues representation"]',
    );
    if (select instanceof HTMLSelectElement) {
      select.value = 'highlight';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    document.querySelector('.color-swatch')?.click();
  })()`);
  await pause(500);
  const afterHighlight = await evaluate(`(() => ({
    errorHidden: document.querySelector('.error-box')?.hidden,
    value: document.querySelector(
      'select[aria-label="Selected residues representation"]',
    )?.value,
  }))()`);

  operations = {
    afterBallAndStick,
    afterChainSelect,
    afterFocusOff,
    afterFocusOn,
    afterHide,
    afterHighlight,
    afterIsolateOff,
    afterIsolateOn,
    afterShow,
    afterShowAll,
    afterSticks,
    afterSurface,
    controls,
    selectionStyleInitial,
  };
}

const interaction = await evaluate(`(() => ({
  errorText: document.querySelector('.field-error')?.textContent,
  selected: document.querySelector('.selected-label')?.textContent,
}))()`);

let remote = null;
let remoteElapsedMs = null;
let remoteLoading = null;
let remoteTiming = null;
if (remoteIdentifier !== undefined) {
  const remoteStartedAt = globalThis.performance.now();
  remoteLoading = await evaluate(`(() => {
    const input = document.querySelector('.identifier-input');
    if (input instanceof HTMLInputElement) input.value = ${JSON.stringify(remoteIdentifier)};
    document.querySelector('.identifier-form')?.requestSubmit();
    return {
      chains: [...document.querySelectorAll('.chain-list .entity-chip')]
        .map((node) => node.textContent),
      emptyHidden: document.querySelector('.empty-state')?.hidden,
      status: document.querySelector('.load-status')?.textContent,
    };
  })()`);
  for (let attempt = 0; attempt < 120; attempt += 1) {
    remote = await evaluate(`(() => ({
      canvasCount: document.querySelectorAll('canvas').length,
      chains: [...document.querySelectorAll('.chain-list .entity-chip')]
        .map((node) => node.textContent),
      errorHidden: document.querySelector('.error-box')?.hidden,
      errorText: document.querySelector('.error-box')?.textContent?.trim(),
      sequenceCells: document.querySelectorAll('.residue-cell').length,
      status: document.querySelector('.load-status')?.textContent,
    }))()`);
    if (remote.errorHidden === false || remote.sequenceCells > 2) break;
    await pause(250);
  }
  remoteElapsedMs = Number((globalThis.performance.now() - remoteStartedAt).toFixed(1));
  remoteTiming = await evaluate(`globalThis.__PROTPEEK_LAST_TIMINGS__ ?? null`);
}

socket.close();

const failures = [];
if (initial.ready !== 'complete') failures.push('panel document did not finish loading');
if (initial.brand !== 'ProtPeek') failures.push('brand was not rendered');
if (initial.empty !== 'Drop a structure') failures.push('empty state was not rendered');
if (initial.chooseFile !== 'Choose file') failures.push('file chooser was not rendered');
if (initial.canvasCount !== 0 || initial.molstarLoaded) {
  failures.push('Molstar was loaded before a structure was requested');
}
if (initialLoading.emptyHidden !== true) {
  failures.push('empty state remained visible during the initial load');
}
if (initial.bodyWidth > initial.viewportWidth) failures.push('320 px layout overflows horizontally');
if (initial.bodyHeight > initial.viewportHeight) failures.push('700 px layout overflows vertically');
if (loaded?.errorHidden === false) failures.push(`fixture load failed: ${loaded.errorText}`);
if (loaded?.canvasCount < 1) failures.push('Molstar canvas was not created');
if (!loaded?.chains.includes('Chain A')) failures.push('fixture chain A was not extracted');
if (loaded?.downloadHidden !== false || loaded?.downloadDisabled !== false) {
  failures.push('download button was not available after loading');
}
if (loaded?.downloadAriaLabel !== 'Download structure as PDBx/mmCIF') {
  failures.push('download button is missing its accessible label');
}
if (interaction.errorText !== '') failures.push(`residue selection failed: ${interaction.errorText}`);
if (operations.controls?.chainLabel !== 'Chain A') {
  failures.push('chain control does not use the explicit Chain A label');
}
if (
  operations.controls?.downloadHidden !== false ||
  operations.controls?.downloadDisabled !== false ||
  operations.controls?.downloadAriaLabel !== 'Download structure as PDBx/mmCIF'
) {
  failures.push('download control is missing from the loaded viewer');
}
if (operations.controls?.focusDisabled !== true) {
  failures.push('Focus was enabled before a selection existed');
}
if (
  JSON.stringify(operations.controls?.selectionRepresentationOptions) !==
  JSON.stringify([
    { label: 'Highlight', value: 'highlight' },
    { label: 'Sticks', value: 'sticks' },
    { label: 'Ball & stick', value: 'ball-and-stick' },
  ])
) {
  failures.push('selection representation options are incomplete');
}
if (operations.controls?.selectionRepresentationDisabled !== true) {
  failures.push('selection representation was enabled without a selection');
}
if (
  operations.afterChainSelect?.selected !== 'Chain A' ||
  operations.afterChainSelect?.focusPressed !== 'true' ||
  operations.afterChainSelect?.focusActive !== true
) {
  failures.push('selecting Chain A did not expose the active Focus state');
}
if (
  operations.afterFocusOff?.pressed !== 'false' ||
  operations.afterFocusOff?.active !== false
) {
  failures.push('Focus could not be deactivated');
}
if (
  operations.afterFocusOn?.pressed !== 'true' ||
  operations.afterFocusOn?.active !== true
) {
  failures.push('Focus could not be reactivated');
}
if (
  operations.afterIsolateOn?.pressed !== 'true' ||
  operations.afterIsolateOn?.active !== true ||
  operations.afterIsolateOn?.showAllHidden !== false ||
  operations.afterIsolateOn?.errorHidden === false
) {
  failures.push('Isolate did not expose its active and reversible state');
}
if (
  operations.afterIsolateOff?.pressed !== 'false' ||
  operations.afterIsolateOff?.active !== false ||
  operations.afterIsolateOff?.errorHidden === false ||
  operations.afterIsolateOff?.focusPressed !== 'false' ||
  operations.afterIsolateOff?.showAllHidden !== true
) {
  failures.push('Isolate could not restore the complete view');
}
if (
  operations.afterShowAll?.focusPressed !== 'false' ||
  operations.afterShowAll?.isolatePressed !== 'false' ||
  operations.afterShowAll?.showAllHidden !== true ||
  operations.afterShowAll?.errorHidden === false
) {
  failures.push('Show all did not restore the complete view');
}
if (
  operations.afterHide?.ariaLabel !== 'Show chain A' ||
  operations.afterHide?.pressed !== 'false' ||
  operations.afterHide?.active !== false ||
  operations.afterHide?.showAllHidden !== false ||
  operations.afterHide?.errorHidden === false
) {
  failures.push('chain visibility control did not enter its hidden state');
}
if (
  operations.afterShow?.ariaLabel !== 'Hide chain A' ||
  operations.afterShow?.pressed !== 'true' ||
  operations.afterShow?.active !== true ||
  operations.afterShow?.showAllHidden !== true ||
  operations.afterShow?.errorHidden === false
) {
  failures.push('chain visibility control could not restore Chain A');
}
if (
  operations.selectionStyleInitial?.disabled !== false ||
  operations.selectionStyleInitial?.value !== 'highlight' ||
  operations.selectionStyleInitial?.selected !== 'A:5'
) {
  failures.push('selected residues did not start in Highlight mode');
}
if (
  operations.afterSticks?.value !== 'sticks' ||
  operations.afterSticks?.errorHidden === false
) {
  failures.push('Sticks selection representation failed');
}
if (
  operations.afterBallAndStick?.value !== 'ball-and-stick' ||
  operations.afterBallAndStick?.errorHidden === false
) {
  failures.push('Ball & stick selection representation failed');
}
if (
  operations.afterHighlight?.value !== 'highlight' ||
  operations.afterHighlight?.errorHidden === false
) {
  failures.push('Highlight selection representation could not be restored');
}
if (operations.afterSurface?.errorHidden === false) failures.push('surface rendering failed');
if (remote?.errorHidden === false) failures.push(`remote load failed: ${remote.errorText}`);
if (remoteIdentifier !== undefined && remoteLoading?.emptyHidden !== true) {
  failures.push('empty state became visible during replacement acquisition');
}
if (remoteIdentifier !== undefined && !remoteLoading?.chains.includes('Chain A')) {
  failures.push('current structure was cleared before replacement acquisition finished');
}
if (remoteIdentifier !== undefined && (remote?.sequenceCells ?? 0) <= 2) {
  failures.push(`remote ${remoteIdentifier} did not replace the local fixture`);
}

process.stdout.write(
  `${JSON.stringify({
    failures,
    frameSample,
    initial,
    initialLoading,
    interaction,
    loaded,
    localElapsedMs,
    localTiming,
    operations,
    remote,
    remoteElapsedMs,
    remoteLoading,
    remoteTiming,
  }, null, 2)}\n`,
);
if (failures.length > 0) process.exitCode = 1;
