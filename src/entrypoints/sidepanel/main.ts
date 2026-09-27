// SPDX-License-Identifier: MPL-2.0
import './style.css';

import { browser } from 'wxt/browser';

import {
  ACTIVATION_REFRESH_DELAY_MS,
  TabRefreshDeduper,
  isRefreshableActiveTabUpdate,
  parseArticlePageChangedMessage,
  sidePanelTabActivatedMessage,
} from '../../browser/sidePanelSession';
import { ProtPeekApp } from '../../ui/ProtPeekApp';
import { logger } from '../../utils/logger';

const root = document.querySelector<HTMLElement>('#app');

if (root === null) {
  throw new Error('ProtPeek root element is missing');
}

const app = new ProtPeekApp(root);
void app.initialize();

// Listen from the live panel document so ordinary background tab changes never
// trigger page access while ProtPeek is closed.
let tabActivationListener:
  | Parameters<typeof browser.tabs.onActivated.addListener>[0]
  | undefined;
let tabUpdateListener:
  | Parameters<typeof browser.tabs.onUpdated.addListener>[0]
  | undefined;
let articleChangeListener:
  | Parameters<typeof browser.runtime.onMessage.addListener>[0]
  | undefined;
let currentTabId: number | undefined;
let activationTimer: number | undefined;
const refreshDeduper = new TabRefreshDeduper();

function clearActivationTimer(): void {
  if (activationTimer === undefined) return;
  window.clearTimeout(activationTimer);
  activationTimer = undefined;
}

function requestArticleRefresh(tabId: number, windowId: number): void {
  void browser.runtime
    .sendMessage(sidePanelTabActivatedMessage(tabId, windowId))
    .catch((error: unknown) =>
      logger.warn('Could not request an article refresh', error),
    );
}

void browser.windows
  .getCurrent()
  .then((currentWindow) => {
    const panelWindowId = currentWindow.id;
    if (panelWindowId === undefined) return;
    tabActivationListener = ({ tabId, windowId }) => {
      if (windowId !== panelWindowId) return;
      currentTabId = tabId;
      clearActivationTimer();
      app.activateArticleTab(tabId);
      void browser.tabs
        .get(tabId)
        .then((tab) => {
          if (
            currentTabId !== tabId ||
            !tab.active ||
            tab.windowId !== panelWindowId
          ) {
            return;
          }
          activationTimer = window.setTimeout(() => {
            activationTimer = undefined;
            if (
              currentTabId === tabId &&
              refreshDeduper.shouldRunActivation(tabId, performance.now())
            ) {
              requestArticleRefresh(tabId, panelWindowId);
            }
          }, ACTIVATION_REFRESH_DELAY_MS);
        })
        .catch((error: unknown) =>
          logger.warn('Could not inspect the active tab', error),
        );
    };
    tabUpdateListener = (tabId, changeInfo, tab) => {
      if (
        tab.active &&
        tab.windowId === panelWindowId &&
        (changeInfo.status === 'loading' || changeInfo.url !== undefined)
      ) {
        currentTabId = tabId;
        clearActivationTimer();
        app.activateArticleTab(tabId);
      }
      if (
        !isRefreshableActiveTabUpdate(
          changeInfo.status,
          changeInfo.url,
          tab.status,
          tab.active,
          tab.windowId,
          panelWindowId,
        )
      ) {
        return;
      }
      currentTabId = tabId;
      clearActivationTimer();
      refreshDeduper.recordCompletion(tabId, performance.now());
      requestArticleRefresh(tabId, panelWindowId);
    };
    articleChangeListener = (message, sender) => {
      if (parseArticlePageChangedMessage(message) === undefined) return false;
      const tab = sender.tab;
      if (
        tab?.id === undefined ||
        !tab.active ||
        tab.windowId !== panelWindowId
      ) {
        return false;
      }
      currentTabId = tab.id;
      clearActivationTimer();
      requestArticleRefresh(tab.id, panelWindowId);
      return false;
    };
    browser.tabs.onActivated.addListener(tabActivationListener);
    browser.tabs.onUpdated.addListener(tabUpdateListener);
    browser.runtime.onMessage.addListener(articleChangeListener);

    void browser.tabs
      .query({ active: true, windowId: panelWindowId })
      .then(([tab]) => {
        if (
          tab?.id === undefined ||
          !tab.active ||
          tab.windowId !== panelWindowId ||
          (currentTabId !== undefined && currentTabId !== tab.id)
        ) {
          return;
        }
        currentTabId = tab.id;
        app.activateArticleTab(tab.id);
        if (tab.status === 'complete') {
          refreshDeduper.recordCompletion(tab.id, performance.now());
          requestArticleRefresh(tab.id, panelWindowId);
        }
      })
      .catch((error: unknown) =>
        logger.warn('Could not inspect the initial active tab', error),
      );
  })
  .catch((error: unknown) => logger.warn('Could not watch active tabs', error));

window.addEventListener(
  'pagehide',
  () => {
    clearActivationTimer();
    if (tabActivationListener !== undefined) {
      browser.tabs.onActivated.removeListener(tabActivationListener);
    }
    if (tabUpdateListener !== undefined) {
      browser.tabs.onUpdated.removeListener(tabUpdateListener);
    }
    if (articleChangeListener !== undefined) {
      browser.runtime.onMessage.removeListener(articleChangeListener);
    }
  },
  { once: true },
);
