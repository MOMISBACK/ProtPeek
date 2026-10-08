// SPDX-License-Identifier: MPL-2.0
import './nativeTimers';
import '../entrypoints/sidepanel/style.css';
import './style.css';
import { ProtPeekApp } from '../ui/ProtPeekApp';
import { initializeZoteroBrowser } from './browserShim';
import type { ZoteroPanelBridge } from './types';
import { initializeZoteroSelectMenus } from './selectMenus';

interface PanelHostWindow extends Window { arguments?: [ZoteroPanelBridge]; }

const root = document.querySelector<HTMLElement>('#app');
if (root === null) throw new Error('The ProtPeek root element is missing.');
const bridge = (window.parent as PanelHostWindow).arguments?.[0];
if (bridge === undefined) {
  root.textContent = 'Open ProtPeek from Zotero’s Tools menu or its PDF reader.';
} else {
  const browser = initializeZoteroBrowser(bridge);
  const app = new ProtPeekApp(root);
  for (const action of root.querySelectorAll('.download-button, .image-button')) action.remove();
  const disposeSelectMenus = initializeZoteroSelectMenus(root);
  const context = document.querySelector<HTMLElement>('#document-title');
  if (context !== null) {
    context.textContent = bridge.title;
    context.title = bridge.title;
  }
  app.activateArticleTab(bridge.itemId);
  void app.initialize().then(() => browser.refresh()).catch((error: unknown) => {
    const status = document.querySelector<HTMLElement>('.page-scan-status');
    if (status !== null) status.textContent = error instanceof Error ? error.message : 'This document could not be scanned.';
  });
  window.addEventListener('pagehide', () => {
    disposeSelectMenus(); app.dispose(); browser.dispose();
  }, { once: true });
}
