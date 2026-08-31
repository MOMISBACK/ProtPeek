// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  ACTIVATED_TAB_SCAN_ERROR,
  ARTICLE_SCAN_ERROR,
  scanArticleTab,
} from '../../src/extension/articleScanTask';

describe('scanArticleTab', () => {
  it('returns validated detections for the activated tab', async () => {
    const valid = {
      displayId: '1CRN',
      format: 'legacy',
      id: '1crn',
      sources: ['text'],
    };
    const scanTab = vi.fn().mockResolvedValue([valid, { id: 123 }]);

    await expect(scanArticleTab(42, scanTab)).resolves.toEqual({
      payload: { structures: [valid], tabId: 42 },
      status: 'success',
    });
    expect(scanTab).toHaveBeenCalledOnce();
  });

  it('uses the ordinary error for an explicit toolbar scan', async () => {
    const failure = new Error('Cannot inject into this page');

    await expect(
      scanArticleTab(7, async () => Promise.reject(failure)),
    ).resolves.toEqual({
      error: failure,
      payload: {
        error: ARTICLE_SCAN_ERROR,
        structures: [],
        tabId: 7,
      },
      status: 'failure',
    });
  });

  it('explains the activeTab gesture required after switching tabs', async () => {
    await expect(
      scanArticleTab(
        8,
        async () => Promise.reject(new Error('Missing host permission')),
        ACTIVATED_TAB_SCAN_ERROR,
      ),
    ).resolves.toMatchObject({
      payload: {
        error: 'Click the ProtPeek toolbar button to scan this tab',
        structures: [],
        tabId: 8,
      },
      status: 'failure',
    });
  });
});
