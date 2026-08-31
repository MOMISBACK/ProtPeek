// SPDX-License-Identifier: MPL-2.0
export interface BrowserAdapter {
  openSidePanel(windowId?: number): Promise<void>;
  scanTab(tabId: number): Promise<unknown>;
}
