// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { createZoteroBrowserShim } from '../../src/zotero/browserShim';
import { sidePanelTabActivatedMessage } from '../../src/browser/sidePanelSession';
import type { ZoteroPanelBridge, ZoteroScanResult } from '../../src/zotero/types';

function bridge(): ZoteroPanelBridge {
  return {
    itemId: 11, title: 'Paper', initialIdentifier: '1CRN',
    scan: vi.fn(() => Promise.resolve({ tabId: 11, title: 'Paper', structures: [] })),
  };
}

describe('Zotero UI bridge', () => {
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
