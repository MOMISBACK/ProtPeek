// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  ArticleChangeRefreshDebouncer,
  TabRefreshDeduper,
  articlePageChangedMessage,
  isCompletedActiveTabUpdate,
  isRefreshableActiveTabUpdate,
  parseArticlePageChangedMessage,
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

  it('also refreshes a completed active tab after an SPA URL change', () => {
    expect(
      isRefreshableActiveTabUpdate(
        undefined,
        'https://example.test/next',
        'complete',
        true,
        2,
        2,
      ),
    ).toBe(true);
    expect(
      isRefreshableActiveTabUpdate(
        undefined,
        'https://example.test/next',
        'loading',
        true,
        2,
        2,
      ),
    ).toBe(false);
    expect(
      isRefreshableActiveTabUpdate(
        'complete',
        undefined,
        'complete',
        false,
        2,
        2,
      ),
    ).toBe(false);
  });

  it('accepts only the article-change message type', () => {
    const message = articlePageChangedMessage();
    expect(parseArticlePageChangedMessage(message)).toEqual(message);
    expect(parseArticlePageChangedMessage(null)).toBeUndefined();
    expect(
      parseArticlePageChangedMessage({ type: 'another-message' }),
    ).toBeUndefined();
  });

  it('coalesces a burst of article mutations and supports cancellation', () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const debouncer = new ArticleChangeRefreshDebouncer(callback, 500);

      debouncer.schedule();
      vi.advanceTimersByTime(400);
      debouncer.schedule();
      vi.advanceTimersByTime(499);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledOnce();

      debouncer.schedule();
      debouncer.cancel();
      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not starve a refresh on a continuously mutating page', () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const debouncer = new ArticleChangeRefreshDebouncer(
        callback,
        500,
        2_000,
      );

      debouncer.schedule();
      for (let index = 0; index < 4; index += 1) {
        vi.advanceTimersByTime(400);
        debouncer.schedule();
      }
      vi.advanceTimersByTime(399);
      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(callback).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
