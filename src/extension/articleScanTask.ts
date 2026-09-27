// SPDX-License-Identifier: MPL-2.0
import type { ScanPayload } from '../browser/sessionPayloads';

import { articleStructuresFromScanResult } from './articleScanResult';

export const ACTIVATED_TAB_SCAN_ERROR =
  'This page cannot be scanned';
export const ARTICLE_SCAN_ERROR = 'This page cannot be scanned';

export type ArticleScanOutcome =
  | { payload: ScanPayload; status: 'success' }
  | { error: unknown; payload: ScanPayload; status: 'failure' };

/**
 * Runs the scripting-boundary scan and always returns a serializable payload.
 * The caller remains responsible for rejecting stale results before storage.
 */
export async function scanArticleTab(
  tabId: number,
  scanTab: () => Promise<unknown>,
  failureMessage = ARTICLE_SCAN_ERROR,
): Promise<ArticleScanOutcome> {
  try {
    const result = await scanTab();
    return {
      payload: {
        structures: articleStructuresFromScanResult(result),
        tabId,
      },
      status: 'success',
    };
  } catch (error) {
    return {
      error,
      payload: {
        error: failureMessage,
        structures: [],
        tabId,
      },
      status: 'failure',
    };
  }
}
