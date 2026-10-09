// SPDX-License-Identifier: MPL-2.0
import { identifierFromContextMenuSelection } from '../extension/contextMenuSelection';
import { parseStructureIdentifier } from '../structures/identifiers';
import { resolveArticleAttachment, scanZoteroArticle, isSupportedAttachment } from './article';
import { createZoteroBackgroundPreference } from './viewerBackgroundPreference';
import type { ZoteroPreferenceHost } from './viewerBackgroundPreference';
import type { ZoteroArticleHost, ZoteroItem, ZoteroPanelBridge } from './types';

interface ZoteroWindow extends Window {
  openDialog(url: string, name: string, features: string, argument: ZoteroPanelBridge): Window;
  Zotero_Tabs?: { selectedID: string };
  ZoteroPane?: { getSelectedItems(): ZoteroItem[] };
}
interface ReaderEvent {
  reader: { itemID: number };
  doc: Document;
  params: { annotation?: { text?: string } };
  append(this: void, element: HTMLElement): void;
}
interface PaneEvent {
  doc: Document;
  body: HTMLElement;
  item?: ZoteroItem;
  setEnabled(this: void, enabled: boolean): void;
}
interface ZoteroPluginHost extends ZoteroArticleHost {
  Prefs: ZoteroPreferenceHost;
  initializationPromise: Promise<void>;
  getMainWindow(): ZoteroWindow | undefined;
  getMainWindows(): ZoteroWindow[];
  logError(error: unknown): void;
  Reader: {
    getByTabID(id: string): { itemID: number } | undefined;
    registerEventListener(type: string, handler: (event: ReaderEvent) => void, id: string): void;
    unregisterEventListener(type: string, handler: (event: ReaderEvent) => void): void;
  };
  ItemPaneManager: {
    registerSection(options: {
      paneID: string; pluginID: string;
      header: { l10nID: string; icon: string };
      sidenav: { l10nID: string; icon: string };
      onItemChange(event: PaneEvent): void;
      onRender(event: PaneEvent): void;
    }): string;
    unregisterSection(id: string): void;
  };
  ProtPeek?: { open(itemId?: number, identifier?: string): Promise<Window | undefined> };
}

declare const Zotero: ZoteroPluginHost;
declare const Services: { io: { newURI(url: string): unknown } };
declare const Cc: Record<string, { getService(type: unknown): {
  registerChrome(uri: unknown, entries: string[][]): { destruct(): void };
} }>;
declare const Ci: { amIAddonManagerStartup: unknown };

const PLUGIN_ID = 'protpeek-zotero@momisback.github.io';
const XHTML = 'http://www.w3.org/1999/xhtml';
const viewers = new Set<Window>();
const controls = new Map<Element, () => void>();
let chromeHandle: { destruct(): void } | undefined;
let sectionId: string | undefined;
let alive = false;

function rememberControl(control: Element): void {
  const doc = control.ownerDocument;
  const owner = doc.defaultView;
  const onPageHide = (event: Event): void => {
    if (event.target !== doc) return;
    controls.delete(control);
    owner?.removeEventListener('pagehide', onPageHide);
  };
  controls.set(control, () => owner?.removeEventListener('pagehide', onPageHide));
  owner?.addEventListener('pagehide', onPageHide);
}

async function open(itemId?: number, identifier?: string): Promise<Window | undefined> {
  const owner = Zotero.getMainWindow();
  if (!alive || owner === undefined) return undefined;
  if (identifier !== undefined && parseStructureIdentifier(identifier) === null) {
    throw new Error('Invalid structure identifier.');
  }
  if (itemId === undefined) {
    const tabId = owner.Zotero_Tabs?.selectedID;
    itemId = tabId === undefined ? undefined : Zotero.Reader.getByTabID(tabId)?.itemID;
    itemId ??= owner.ZoteroPane?.getSelectedItems()[0]?.id;
  }
  let attachment: ZoteroItem | undefined;
  let error = 'Select a paper with a local PDF or HTML attachment, or use Open.';
  if (itemId !== undefined) {
    try { attachment = await resolveArticleAttachment(Zotero, itemId); }
    catch (cause: unknown) { if (cause instanceof Error) error = cause.message; }
  }
  if (!alive || owner.closed) return undefined;
  const tabId = attachment?.id ?? itemId ?? 0;
  const title = attachment?.getField('title') || 'No readable document selected';
  const bridge: ZoteroPanelBridge = {
    itemId: tabId,
    title,
    ...(identifier === undefined ? {} : { initialIdentifier: identifier }),
    scan: () => attachment === undefined
      ? Promise.resolve({ tabId, title, error, structures: [] })
      : scanZoteroArticle(Zotero, attachment),
    ...createZoteroBackgroundPreference(Zotero.Prefs),
  };
  // A non-modal native window keeps the PDF visible. The original ProtPeek UI
  // and Mol* run in its local iframe, with only this narrow bridge.
  const viewer = owner.openDialog(
    'chrome://protpeek/content/window.xhtml',
    '_blank',
    'chrome,centerscreen,resizable,dialog=no,width=520,height=820',
    bridge,
  );
  viewers.add(viewer);
  // openDialog can unload its initial about:blank document before our window
  // loads. Only remove the viewer when the actual top-level document unloads.
  const onUnload = (event: Event): void => {
    if (event.target !== viewer.document
      || viewer.document.documentURI !== 'chrome://protpeek/content/window.xhtml') return;
    viewers.delete(viewer);
    viewer.removeEventListener('unload', onUnload);
  };
  viewer.addEventListener('unload', onUnload);
  return viewer;
}

function openFromControl(itemId?: number, identifier?: string): void {
  void open(itemId, identifier).catch((error: unknown) => Zotero.logError(error));
}

function readerToolbar({ reader, doc, append }: ReaderEvent): void {
  const control = doc.createElementNS(XHTML, 'button');
  control.setAttribute('type', 'button');
  control.textContent = 'ProtPeek';
  control.title = 'Inspect protein structures in this document';
  control.setAttribute('data-protpeek-toolbar', '');
  control.style.cssText = 'font:inherit;color:inherit;background:transparent;border:0;padding:4px 8px;cursor:pointer;';
  control.addEventListener('click', () => openFromControl(reader.itemID));
  rememberControl(control);
  append(control);
}

function selectionPopup({ reader, doc, params, append }: ReaderEvent): void {
  const identifier = identifierFromContextMenuSelection(params.annotation?.text);
  if (identifier === null) return;
  const control = doc.createElementNS(XHTML, 'button');
  control.setAttribute('type', 'button');
  control.textContent = `Open ${identifier} in ProtPeek`;
  control.addEventListener('click', () => openFromControl(reader.itemID, identifier));
  rememberControl(control);
  append(control);
}

function onMainWindowLoad({ window }: { window: ZoteroWindow }): void {
  if (!alive || window.document.getElementById('protpeek-tools-menu') !== null) return;
  const menu = window.document.getElementById('menu_ToolsPopup');
  if (menu === null) return;
  const control = window.document.createElementNS(
    'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul', 'menuitem',
  );
  control.id = 'protpeek-tools-menu';
  control.setAttribute('label', 'ProtPeek — Protein structures');
  control.addEventListener('command', () => openFromControl());
  menu.append(control);
  rememberControl(control);
}

function onMainWindowUnload({ window }: { window: ZoteroWindow }): void {
  window.document.getElementById('protpeek-tools-menu')?.remove();
}

async function startup({ rootURI }: { rootURI: string }): Promise<void> {
  await Zotero.initializationPromise;
  const factory = Cc['@mozilla.org/addons/addon-manager-startup;1'];
  if (factory === undefined) throw new Error('The Zotero chrome registry is unavailable.');
  chromeHandle = factory.getService(Ci.amIAddonManagerStartup).registerChrome(
    Services.io.newURI(`${rootURI}manifest.json`), [['content', 'protpeek', './']],
  );
  alive = true;
  Zotero.ProtPeek = { open };
  Zotero.Reader.registerEventListener('renderToolbar', readerToolbar, PLUGIN_ID);
  Zotero.Reader.registerEventListener('renderTextSelectionPopup', selectionPopup, PLUGIN_ID);
  sectionId = Zotero.ItemPaneManager.registerSection({
    paneID: 'protpeek-structures', pluginID: PLUGIN_ID,
    header: { l10nID: 'protpeek-section-title', icon: `${rootURI}icon-16.png` },
    sidenav: { l10nID: 'protpeek-section-tooltip', icon: `${rootURI}icon-16.png` },
    onItemChange: ({ item, setEnabled }) => {
      setEnabled(item !== undefined && (item.isRegularItem() || isSupportedAttachment(item)));
    },
    onRender: ({ doc, body, item }) => {
      body.replaceChildren();
      const control = doc.createElementNS(XHTML, 'button');
      control.setAttribute('type', 'button');
      control.textContent = 'Open ProtPeek';
      control.addEventListener('click', () => openFromControl(item?.id));
      const description = doc.createElementNS(XHTML, 'p');
      description.textContent = 'Scan this paper locally and inspect its protein structures.';
      body.append(control, description);
    },
  });
  for (const window of Zotero.getMainWindows()) onMainWindowLoad({ window });
}

function shutdown(): void {
  alive = false;
  for (const viewer of viewers) if (!viewer.closed) viewer.close();
  viewers.clear();
  for (const [control, release] of controls) { release(); control.remove(); }
  controls.clear();
  Zotero.Reader.unregisterEventListener('renderToolbar', readerToolbar);
  Zotero.Reader.unregisterEventListener('renderTextSelectionPopup', selectionPopup);
  if (sectionId !== undefined) Zotero.ItemPaneManager.unregisterSection(sectionId);
  sectionId = undefined;
  delete Zotero.ProtPeek;
  chromeHandle?.destruct();
  chromeHandle = undefined;
}

// Zotero's bootstrap loader looks up lifecycle hooks on the script global.
Object.assign(globalThis, {
  startup, shutdown, onMainWindowLoad, onMainWindowUnload,
  install: (): void => {}, uninstall: (): void => {},
});
