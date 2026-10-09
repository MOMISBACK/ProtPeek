// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { createZoteroBrowserShim } from '../../src/zotero/browserShim';
import { sidePanelTabActivatedMessage } from '../../src/browser/sidePanelSession';
import { ViewerBackgroundPreference, VIEWER_BACKGROUND_STORAGE_KEY } from '../../src/ui/viewerBackgroundPreference';
import { createZoteroBackgroundPreference } from '../../src/zotero/viewerBackgroundPreference';
import type { ZoteroPanelBridge, ZoteroScanResult } from '../../src/zotero/types';

function bridge(): ZoteroPanelBridge {
  return {
    itemId: 11, title: 'Paper', initialIdentifier: '1CRN',
    scan: vi.fn(() => Promise.resolve({ tabId: 11, title: 'Paper', structures: [] })),
  };
}

describe('Zotero UI bridge', () => {
  it('persists the shared viewer preference through the narrow host bridge when reopened', async () => {
    let saved: unknown;
    const prefs = {
      get: () => saved,
      set: (_key: string, value: string) => { saved = value; },
      clear: () => { saved = undefined; },
    };
    const context = { ...bridge(), ...createZoteroBackgroundPreference(prefs) };
    const initial = createZoteroBrowserShim(context);
    const preference = new ViewerBackgroundPreference(initial.storage.local);
    expect(await preference.read()).toBe('white');
    await preference.set('black');
    initial.dispose();
    const reopened = createZoteroBrowserShim(context);
    expect(await new ViewerBackgroundPreference(reopened.storage.local).read()).toBe('black');
  });

  it('keeps the preference in memory if an older test bridge lacks preference methods', async () => {
    const shim = createZoteroBrowserShim(bridge());
    const preference = new ViewerBackgroundPreference(shim.storage.local);
    expect(await preference.read()).toBe('white');
    await preference.set('black');
    expect(await preference.read()).toBe('black');
  });

  it('exposes only the viewer preference and rejects invalid values', async () => {
    const context = {
      ...bridge(),
      getViewerBackground: vi.fn(() => 'black' as const),
      setViewerBackground: vi.fn(),
    };
    const shim = createZoteroBrowserShim(context);
    expect(await shim.storage.local.get(['unrelated-preference'])).toEqual({});
    await shim.storage.local.set({ 'unrelated-preference': 'black' });
    await expect(shim.storage.local.set({ [VIEWER_BACKGROUND_STORAGE_KEY]: 'blue' })).rejects.toThrow('Invalid viewer background');
    expect(context.getViewerBackground).not.toHaveBeenCalled();
    expect(context.setViewerBackground).not.toHaveBeenCalled();
    expect(await shim.storage.local.get([VIEWER_BACKGROUND_STORAGE_KEY, 'unrelated-preference'])).toEqual({
      [VIEWER_BACKGROUND_STORAGE_KEY]: 'black',
    });
  });

  it('consumes a deliberate selection once, without scanning on import or adapter creation', async () => {
    const context = bridge();
    const shim = createZoteroBrowserShim(context);
    expect(context.scan).not.toHaveBeenCalled();
    expect(await shim.storage.session.get(['protpeek.load.11'])).toEqual({ 'protpeek.load.11': { identifier: '1CRN' } });
    await shim.storage.session.remove('protpeek.load.11');
    expect(await shim.storage.session.get(['protpeek.load.11'])).toEqual({});
  });

  it('refreshes only the pinned document and emits the existing UI payload', async () => {
    const context = bridge();
    const shim = createZoteroBrowserShim(context);
    const listener = vi.fn();
    shim.storage.onChanged.addListener(listener);
    expect(await shim.runtime.sendMessage(sidePanelTabActivatedMessage(99, 11))).toEqual({ refreshed: false });
    expect(context.scan).not.toHaveBeenCalled();
    expect(await shim.runtime.sendMessage(sidePanelTabActivatedMessage(11, 11))).toEqual({ refreshed: true });
    expect(listener).toHaveBeenCalledWith({ 'protpeek.scan.11': { newValue: { tabId: 11, title: 'Paper', structures: [] } } }, 'session');
  });

  it('drops older asynchronous scan results', async () => {
    let finishOlder: (value: ZoteroScanResult) => void = () => {};
    const context = bridge();
    context.scan = vi.fn()
      .mockImplementationOnce(() => new Promise<ZoteroScanResult>((resolve) => { finishOlder = resolve; }))
      .mockResolvedValueOnce({ tabId: 11, title: 'Newer', structures: [] });
    const shim = createZoteroBrowserShim(context);
    const older = shim.refresh();
    await shim.refresh();
    finishOlder({ tabId: 11, title: 'Older', structures: [] });
    expect(await older).toEqual({ refreshed: false });
    expect(await shim.storage.session.get(['protpeek.scan.11'])).toEqual({ 'protpeek.scan.11': { tabId: 11, title: 'Newer', structures: [] } });
  });

  it('drops results for the wrong document and releases listeners when closed', async () => {
    const context = bridge();
    context.scan = () => Promise.resolve({ tabId: 99, title: 'Other', structures: [] });
    const shim = createZoteroBrowserShim(context);
    const listener = vi.fn();
    shim.storage.onChanged.addListener(listener);
    expect(await shim.refresh()).toEqual({ refreshed: false });
    shim.dispose();
    context.scan = () => Promise.resolve({ tabId: 11, title: 'Paper', structures: [] });
    expect(await shim.refresh()).toEqual({ refreshed: false });
    expect(listener).not.toHaveBeenCalled();
  });
});
