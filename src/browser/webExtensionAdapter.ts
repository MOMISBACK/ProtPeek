// SPDX-License-Identifier: MPL-2.0
import { browser } from 'wxt/browser';

import type { BrowserAdapter } from './BrowserAdapter';

interface SidePanelApi {
  open(options: { windowId?: number }): Promise<void>;
}

interface SidebarActionApi {
  open(): Promise<void>;
}

type ExtendedBrowser = typeof browser & {
  sidePanel?: SidePanelApi;
  sidebarAction?: SidebarActionApi;
};

export class WebExtensionAdapter implements BrowserAdapter {
  readonly #browser = browser as ExtendedBrowser;

  async openSidePanel(windowId?: number): Promise<void> {
    if (this.#browser.sidePanel !== undefined) {
      await this.#browser.sidePanel.open(
        windowId === undefined ? {} : { windowId },
      );
      return;
    }

    if (this.#browser.sidebarAction !== undefined) {
      await this.#browser.sidebarAction.open();
      return;
    }

    throw new Error('This browser does not expose a side panel API');
  }

  async scanTab(tabId: number): Promise<unknown> {
    const [result] = await this.#browser.scripting.executeScript({
      target: { tabId },
      files: ['/article-scan.js'],
    });

    return result?.result ?? [];
  }
}
