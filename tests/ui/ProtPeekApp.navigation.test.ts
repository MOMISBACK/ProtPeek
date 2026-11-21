// SPDX-License-Identifier: MPL-2.0
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ScanPayload } from '../../src/browser/sessionPayloads';
import type { LoadedStructureData, ViewerLoadResult } from '../../src/structures/types';
import type { StructureViewer } from '../../src/viewer/StructureViewer';

const mocks = vi.hoisted(() => ({
  createViewer: vi.fn<() => object>(),
  sessionGet: vi.fn<() => Promise<Record<string, unknown>>>(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  loadRemote: vi.fn<() => Promise<LoadedStructureData>>(),
  queryTabs: vi.fn<() => Promise<Array<{ id: number }>>>(),
  sendMessage: vi.fn<(message: unknown) => Promise<unknown>>(),
}));

vi.mock('wxt/browser', () => ({ browser: {
  storage: {
    local: { get: async () => ({}), set: async () => undefined },
    session: { get: mocks.sessionGet, remove: async () => undefined },
    onChanged: { addListener: mocks.addListener, removeListener: mocks.removeListener },
  },
  windows: { getCurrent: async () => ({ id: 1 }) },
  tabs: { query: mocks.queryTabs },
  runtime: { sendMessage: mocks.sendMessage },
} }));

vi.mock('../../src/viewer/LazyStructureViewer', () => ({
  LazyStructureViewer: class {
    constructor() { return mocks.createViewer(); }
  },
}));

vi.mock('../../src/structures/loaders/rcsb', () => ({
  loadRcsbStructure: mocks.loadRemote,
}));

import { ProtPeekApp } from '../../src/ui/ProtPeekApp';
import { CHROME_EXTENSION_URL, CHROME_REVIEWS_URL, FIREFOX_EXTENSION_URL, FIREFOX_REVIEWS_URL } from '../../src/ui/feedback';

const scan: ScanPayload = {
  tabId: 11,
  structures: [{
    id: '1crn', displayId: '1CRN', type: 'pdb', format: 'legacy', sources: ['text'],
  }],
};

const loaded: LoadedStructureData = {
  data: 'ATOM', format: 'pdb', isBinary: false, label: '1CRN',
  source: { kind: 'pdb', id: '1crn' },
};

const result: ViewerLoadResult = {
  metadata: {
    atomCount: 1,
    chains: [{
      authId: 'A', labelId: 'A', entityId: '1', entityDescription: 'Protein',
      polymerType: 'polypeptide(L)',
      residues: [{
        chainId: 'A', authNumber: 1, labelNumber: 1, code: 'A', compId: 'ALA',
        insertionCode: '', isObserved: true,
      }],
    }],
    ligands: [], source: loaded.source,
  },
  timings: { totalMs: 1 },
};

function required<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`Missing element: ${selector}`);
  return found;
}

function key(target: EventTarget, value: string): Event {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'key', { value });
  target.dispatchEvent(event);
  return event;
}

function flushActions(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('ProtPeekApp navigation and viewer controls', () => {
  let app: ProtPeekApp | undefined;
  let root: HTMLElement;
  let autoRotate: ReturnType<typeof vi.fn<(enabled: boolean) => void>>;
  let resetCamera: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.clearAllMocks();
    const { document, window } = parseHTML('<!doctype html><html><body><div id="app"></div></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', window);
    vi.stubGlobal('location', { href: 'https://extension.example/sidepanel.html' });
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
    root = required(document, '#app');
    autoRotate = vi.fn<(enabled: boolean) => void>();
    resetCamera = vi.fn<() => void>();
    const currentViewer = { setAutoRotate: autoRotate, cancelCurrentTask: vi.fn(), resetCamera } as unknown as StructureViewer;
    const fakeViewer = {
      prepare: vi.fn(async () => undefined),
      load: vi.fn(async () => result),
      withViewer: vi.fn(async (operation: (viewer: StructureViewer) => void | Promise<void>) => {
        await operation(currentViewer);
      }),
      setBackground: vi.fn(async () => undefined),
      resize: vi.fn(), dispose: vi.fn(),
    };
    mocks.createViewer.mockReturnValue(fakeViewer);
    mocks.sessionGet.mockResolvedValue({ 'protpeek.scan.1': scan });
    mocks.loadRemote.mockResolvedValue(loaded);
    mocks.queryTabs.mockResolvedValue([]);
    mocks.sendMessage.mockResolvedValue({ refreshed: false });
  });

  afterEach(() => {
    app?.dispose();
    app = undefined;
    vi.unstubAllGlobals();
  });

  async function mount(loadStructure = false, options: ConstructorParameters<typeof ProtPeekApp>[1] = {}): Promise<void> {
    if (loadStructure) mocks.sessionGet.mockResolvedValue({
      'protpeek.scan.1': scan, 'protpeek.load.1': { identifier: '1CRN' },
    });
    app = new ProtPeekApp(root, { feedbackFormUrl: CHROME_REVIEWS_URL, ...options });
    await app.initialize();
    await flushActions();
  }

  it('keeps Article/Open/Structure in the header, feedback in the footer, and avoids stale article counts', async () => {
    await mount();
    const tabs = [...root.querySelectorAll('.topbar [role="tab"]')];
    expect(tabs.map(tab => tab.id)).toEqual(['page-tab', 'open-tab', 'structure-tab']);
    expect(required(root, '.app-footer .feedback-link').textContent).toBe('Feedback');
    const share = required<HTMLAnchorElement>(root, '.app-footer .share-link');
    expect(share.textContent).toBe('Share');
    expect(share.href).toBe(CHROME_EXTENSION_URL);
    expect(required<HTMLButtonElement>(root, '#structure-tab').disabled).toBe(true);
    const badge = required<HTMLElement>(root, '.structure-count');
    expect(badge.textContent).toBe('1');
    expect(badge.hidden).toBe(false);

    app?.activateArticleTab(22);
    expect(badge.hidden).toBe(true);
    const callback = mocks.addListener.mock.calls[0]?.[0] as
      ((changes: Record<string, { newValue: unknown }>, area: string) => void) | undefined;
    if (callback === undefined) throw new Error('Missing storage listener');
    callback({ 'protpeek.scan.1': { newValue: scan } }, 'session');
    expect(badge.hidden).toBe(true);
    callback({ 'protpeek.scan.1': { newValue: { ...scan, tabId: 22 } } }, 'session');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
  });

  it('keeps Feedback on the Firefox reviews and Share on its extension listing', async () => {
    await mount(false, { feedbackFormUrl: FIREFOX_REVIEWS_URL });
    const feedback = required<HTMLAnchorElement>(root, '.feedback-link');
    const share = required<HTMLAnchorElement>(root, '.share-link');
    expect(feedback.href).toBe(FIREFOX_REVIEWS_URL);
    expect(share.href).toBe(FIREFOX_EXTENSION_URL);
    expect(feedback.nextElementSibling).toBe(share);
    expect(share.target).toBe('_blank');
    expect(share.rel).toBe('noopener noreferrer');
  });

  it('supports a fixed native-host Share action without changing Feedback', async () => {
    const feedback = vi.fn(), share = vi.fn();
    await mount(false, {
      sharePageUrl: 'https://github.com/MOMISBACK/ProtPeek',
      openSharePage: share, openFeedbackForm: feedback,
    });
    required<HTMLAnchorElement>(root, '.share-link').click();
    expect(share).toHaveBeenCalledOnce();
    expect(feedback).not.toHaveBeenCalled();
    required<HTMLAnchorElement>(root, '.feedback-link').click();
    expect(feedback).toHaveBeenCalledOnce();
  });

  it('keeps Reset view accessible as an icon and preserves its camera action', async () => {
    await mount(true);
    const reset = required<HTMLButtonElement>(root, '.reset-view-button');
    expect(reset.textContent).toBe('');
    expect(reset.querySelector('svg')).not.toBeNull();
    expect(reset.getAttribute('aria-label')).toBe('Reset view');
    expect(reset.title).toBe('Reset view');
    reset.click();
    await flushActions();
    expect(resetCamera).toHaveBeenCalledOnce();
  });

  it('accepts a manual rescan of the queried tab after a missed activation event', async () => {
    await mount();
    // The browser's actual active tab has changed, but its activation event was missed.
    app?.activateArticleTab(11);
    mocks.queryTabs.mockResolvedValue([{ id: 22 }]);
    const callback = mocks.addListener.mock.calls[0]?.[0] as
      ((changes: Record<string, { newValue: unknown }>, area: string) => void) | undefined;
    if (callback === undefined) throw new Error('Missing storage listener');
    mocks.sendMessage.mockImplementation(async () => {
      callback({ 'protpeek.scan.1': { newValue: { ...scan, tabId: 22 } } }, 'session');
      return { refreshed: true };
    });

    required<HTMLButtonElement>(root, '.page-view .scan-button').click();
    await flushActions();

    expect(mocks.sendMessage).toHaveBeenCalledWith({
      tabId: 22, windowId: 1, type: 'protpeek-side-panel-tab-activated',
    });
    const badge = required<HTMLElement>(root, '.structure-count');
    expect(badge.hidden).toBe(false);
    expect(badge.textContent).toBe('1');
    expect(required<HTMLElement>(root, '.page-results').hidden).toBe(false);
  });

  it('enables controls after a successful load and stops queued auto rotation on navigation', async () => {
    await mount(true);
    const rotate = required<HTMLButtonElement>(root, '.auto-rotate-button');
    expect(rotate.hidden).toBe(false);
    expect(rotate.disabled).toBe(false);
    autoRotate.mockClear();
    rotate.click();
    expect(rotate.getAttribute('aria-pressed')).toBe('true');
    // Navigate immediately, before the queued enable operation runs.
    required<HTMLButtonElement>(root, '#page-tab').click();
    await flushActions();
    expect(autoRotate.mock.calls.map(call => call[0])).toEqual([true, false]);
    expect(rotate.getAttribute('aria-pressed')).toBe('false');
    expect(required(root, '#page-tab').getAttribute('aria-selected')).toBe('true');
    expect(required<HTMLElement>(root, '#structure-panel').hidden).toBe(true);

    required<HTMLButtonElement>(root, '#structure-tab').click();
    expect(rotate.getAttribute('aria-pressed')).toBe('false');
    expect(required<HTMLElement>(root, '#structure-panel').hidden).toBe(false);
  });

  it('expands reversibly, isolates background controls, and restores them on Escape', async () => {
    await mount(true);
    const expand = required<HTMLButtonElement>(root, '.expand-button');
    const frame = required(root, '.viewer-frame');
    const header = required<HTMLElement>(root, '.topbar');
    const footer = required<HTMLElement>(root, '.app-footer');
    const inspector = required<HTMLElement>(root, '.inspector');
    expect(expand.disabled).toBe(false);
    expand.click();
    expect(frame.classList.contains('is-expanded')).toBe(true);
    expect(expand.getAttribute('aria-label')).toBe('Collapse viewer');
    expect(expand.getAttribute('aria-pressed')).toBe('true');
    expect([header.inert, footer.inert, inspector.inert]).toEqual([true, true, true]);

    const escape = key(document, 'Escape');
    expect(escape.defaultPrevented).toBe(true);
    expect(frame.classList.contains('is-expanded')).toBe(false);
    expect(expand.getAttribute('aria-label')).toBe('Expand viewer');
    expect(expand.getAttribute('aria-pressed')).toBe('false');
    expect([header.inert, footer.inert, inspector.inert]).toEqual([false, false, false]);

    expand.click();
    expand.click();
    expect(frame.classList.contains('is-expanded')).toBe(false);
    expect(header.inert).toBe(false);
  });
});
