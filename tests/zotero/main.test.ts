// SPDX-License-Identifier: MPL-2.0
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZoteroPanelBridge } from '../../src/zotero/types';

const mocks = vi.hoisted(() => ({
  createApp: vi.fn(), initialize: vi.fn(async () => undefined),
  activate: vi.fn(), dispose: vi.fn(), refresh: vi.fn(async () => undefined),
  disposeBrowser: vi.fn(), disposeMenus: vi.fn(), enhanceMenus: vi.fn(),
}));

vi.mock('../../src/zotero/nativeTimers', () => ({}));
vi.mock('../../src/zotero/browserShim', () => ({
  initializeZoteroBrowser: () => ({ refresh: mocks.refresh, dispose: mocks.disposeBrowser }),
}));
vi.mock('../../src/zotero/selectMenus', () => ({
  initializeZoteroSelectMenus: (root: HTMLElement) => {
    mocks.enhanceMenus(root); return mocks.disposeMenus;
  },
}));
vi.mock('../../src/ui/ProtPeekApp', () => ({
  ProtPeekApp: class {
    constructor(root: HTMLElement, options: object) {
      mocks.createApp(root, options);
      root.innerHTML = '<button class="download-button"></button><button class="image-button"></button>'
        + '<button class="auto-rotate-button"></button><button class="expand-button"></button>'
        + '<button class="reset-view-button"></button>';
    }
    initialize = mocks.initialize;
    activateArticleTab = mocks.activate;
    dispose = mocks.dispose;
  },
}));

describe('Zotero viewer entry point', () => {
  let bridge: ZoteroPanelBridge;
  beforeEach(() => {
    vi.clearAllMocks(); vi.resetModules();
    const { window, document } = parseHTML('<html><body><span id="document-title"></span><div id="app"></div></body></html>');
    bridge = {
      itemId: 23, title: 'Pinned article', scan: async () => ({ tabId: 23, title: 'Pinned article', structures: [] }),
      openFeedbackForm: vi.fn(), openSharePage: vi.fn(),
      saveStructure: vi.fn(async () => undefined), saveImage: vi.fn(async () => undefined),
    };
    Object.defineProperty(window, 'parent', { configurable: true, value: { arguments: [bridge] } });
    vi.stubGlobal('window', window); vi.stubGlobal('document', document); vi.stubGlobal('Event', window.Event);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps native exports and shared viewer controls, with GitHub Share & feedback', async () => {
    await import('../../src/zotero/main');
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    const options = mocks.createApp.mock.calls[0]?.[1] as {
      sharePageUrl: string; openSharePage: () => void;
      saveStructure: unknown; saveImage: unknown; feedbackFormUrl?: string;
    };
    expect(options.sharePageUrl).toBe('https://github.com/MOMISBACK/ProtPeek');
    options.openSharePage();
    expect(bridge.openSharePage).toHaveBeenCalledOnce();
    expect(bridge.openFeedbackForm).not.toHaveBeenCalled();
    expect(options.feedbackFormUrl).toBeUndefined();
    expect(options.saveStructure).toBe(bridge.saveStructure);
    expect(options.saveImage).toBe(bridge.saveImage);
    for (const selector of ['.download-button', '.image-button', '.auto-rotate-button', '.expand-button', '.reset-view-button']) {
      expect(document.querySelector(selector)).not.toBeNull();
    }
    expect(mocks.activate).toHaveBeenCalledWith(23);
    expect(document.getElementById('document-title')?.textContent).toBe('Pinned article');
    expect(mocks.enhanceMenus).toHaveBeenCalledWith(document.getElementById('app'));
  });

  it('retains a working external-link callback and hides unavailable exports on an older bridge', async () => {
    delete bridge.openSharePage; delete bridge.saveStructure; delete bridge.saveImage;
    await import('../../src/zotero/main');
    const options = mocks.createApp.mock.calls[0]?.[1] as { openSharePage: () => void };
    options.openSharePage();
    expect(bridge.openFeedbackForm).toHaveBeenCalledOnce();
    expect(document.querySelector('.download-button')).toBeNull();
    expect(document.querySelector('.image-button')).toBeNull();
    expect(document.querySelector('.auto-rotate-button')).not.toBeNull();
    expect(document.querySelector('.expand-button')).not.toBeNull();
  });

  it('disposes the native menu adapter, viewer and document bridge when the panel closes', async () => {
    await import('../../src/zotero/main');
    window.dispatchEvent(new Event('pagehide'));
    expect(mocks.disposeMenus).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalledOnce();
    expect(mocks.disposeBrowser).toHaveBeenCalledOnce();
  });
});
