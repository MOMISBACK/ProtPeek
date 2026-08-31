// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  TabRefreshDeduper,
  isCompletedActiveTabUpdate,
  parseSidePanelTabActivatedMessage,
  sidePanelTabActivatedMessage,
} from '../../src/browser/sidePanelSession';

describe('side-panel session', () => {
  it('accepts a valid tab-activation message', () => {
    const message = sidePanelTabActivatedMessage(4, 12);
    expect(parseSidePanelTabActivatedMessage(message)).toEqual(message);
  });

  it.each([
    null,
    { type: 'another-message', tabId: 4, windowId: 12 },
    { type: 'protpeek-side-panel-tab-activated', tabId: -1, windowId: 12 },
    { type: 'protpeek-side-panel-tab-activated', tabId: 4, windowId: -1 },
    { type: 'protpeek-side-panel-tab-activated', tabId: 4.5, windowId: 12 },
  ])('rejects an invalid activation message: %j', (message) => {
    expect(parseSidePanelTabActivatedMessage(message)).toBeUndefined();
  });

  it('coalesces a delayed activation scan after an immediate completed-page scan', () => {
    const deduper = new TabRefreshDeduper();
    deduper.recordCompletion(4, 1_000);

    expect(deduper.shouldRunActivation(4, 1_100)).toBe(false);
    expect(deduper.shouldRunActivation(4, 1_250)).toBe(true);
    expect(deduper.shouldRunActivation(5, 1_100)).toBe(true);
  });

  it('refreshes only a completed active tab from the panel window', () => {
    expect(isCompletedActiveTabUpdate('complete', true, 2, 2)).toBe(true);
    expect(isCompletedActiveTabUpdate('loading', true, 2, 2)).toBe(false);
    expect(isCompletedActiveTabUpdate('complete', false, 2, 2)).toBe(false);
    expect(isCompletedActiveTabUpdate('complete', true, 3, 2)).toBe(false);
  });
});
