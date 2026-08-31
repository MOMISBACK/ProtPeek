// SPDX-License-Identifier: MPL-2.0
import { browser } from 'wxt/browser';

import { WebExtensionAdapter } from '../browser/webExtensionAdapter';
import { parseSidePanelTabActivatedMessage } from '../browser/sidePanelSession';
import {
  loadStorageKey,
  scanStorageKey,
  type LoadPayload,
} from '../browser/sessionPayloads';
import {
  ACTIVATED_TAB_SCAN_ERROR,
  ARTICLE_SCAN_ERROR,
  scanArticleTab,
} from '../extension/articleScanTask';
import { identifierFromContextMenuSelection } from '../extension/contextMenuSelection';
import { logger } from '../utils/logger';

const CONTEXT_MENU_ID = 'protpeek-view-selection';
const scanGenerationByWindow = new Map<number, number>();

function beginScanGeneration(windowId: number): number {
  const generation = (scanGenerationByWindow.get(windowId) ?? 0) + 1;
  scanGenerationByWindow.set(windowId, generation);
  return generation;
}

function isCurrentScan(windowId: number, generation: number): boolean {
  return scanGenerationByWindow.get(windowId) === generation;
}

async function scanArticle(
  adapter: WebExtensionAdapter,
  tabId: number,
  windowId: number,
  generation: number,
  failureMessage = ARTICLE_SCAN_ERROR,
): Promise<void> {
  const outcome = await scanArticleTab(
    tabId,
    () => adapter.scanTab(tabId),
    failureMessage,
  );
  if (!isCurrentScan(windowId, generation)) return;

  await browser.storage.session.set({
    [scanStorageKey(windowId)]: outcome.payload,
  });
  if (outcome.status === 'failure') {
    logger.warn('Article scan failed', outcome.error);
  }
}

export default defineBackground(() => {
  const adapter = new WebExtensionAdapter();

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const activation = parseSidePanelTabActivatedMessage(message);
    if (activation === undefined) return false;
    const refreshing = browser.tabs.get(activation.tabId).then(async (tab) => {
      if (!tab.active || tab.windowId !== activation.windowId) return false;
      const generation = beginScanGeneration(activation.windowId);
      await scanArticle(
        adapter,
        activation.tabId,
        activation.windowId,
        generation,
        ACTIVATED_TAB_SCAN_ERROR,
      );
      return true;
    });
    void refreshing.then(
      (refreshed) => sendResponse({ refreshed }),
      (error: unknown) => {
        logger.warn('Could not refresh article results', error);
        sendResponse({ refreshed: false });
      },
    );
    return true;
  });

  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      contexts: ['selection'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
      id: CONTEXT_MENU_ID,
      title: 'View in ProtPeek',
    });
  });

  browser.action.onClicked.addListener((tab) => {
    const windowId = tab.windowId;
    if (windowId === undefined) {
      logger.warn('Toolbar action has no browser window');
      return;
    }

    const generation = beginScanGeneration(windowId);
    const opening = adapter.openSidePanel(windowId);
    const scanning =
      tab.id === undefined
        ? Promise.resolve()
        : scanArticle(adapter, tab.id, windowId, generation);
    void Promise.allSettled([opening, scanning]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn('Toolbar action did not complete', result.reason);
        }
      }
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (
      info.menuItemId !== CONTEXT_MENU_ID ||
      tab?.windowId === undefined ||
      info.selectionText === undefined
    ) {
      return;
    }

    const identifier = identifierFromContextMenuSelection(info.selectionText);
    if (identifier === null) return;

    const payload: LoadPayload = { identifier };
    const storing = browser.storage.session.set({
      [loadStorageKey(tab.windowId)]: payload,
    });
    const opening = adapter.openSidePanel(tab.windowId);
    void Promise.allSettled([storing, opening]).then((results) => {
      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn('Context menu action did not complete', result.reason);
        }
      }
    });
  });

  browser.windows.onRemoved.addListener((windowId) => {
    scanGenerationByWindow.delete(windowId);
    void browser.storage.session
      .remove([scanStorageKey(windowId), loadStorageKey(windowId)])
      .catch((error: unknown) => logger.warn('Could not clear window session data', error));
  });
});
