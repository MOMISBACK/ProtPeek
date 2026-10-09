// SPDX-License-Identifier: MPL-2.0
import { loadStorageKey, scanStorageKey } from '../browser/sessionPayloads';
import { parseSidePanelTabActivatedMessage } from '../browser/sidePanelSession';
import { VIEWER_BACKGROUND_STORAGE_KEY } from '../ui/viewerBackgroundPreference';
import type { ViewerBackground } from '../viewer/StructureViewer';
import type { ZoteroPanelBridge } from './types';

interface StorageChange { newValue?: unknown; }
type StorageListener = (changes: Record<string, StorageChange>, areaName: string) => void;

/** Document session state stays in memory; one UI preference uses Zotero.Prefs. */
export function createZoteroBrowserShim(bridge: ZoteroPanelBridge) {
  const listeners = new Set<StorageListener>();
  const values: Record<string, unknown> = {};
  const windowId = bridge.itemId;
  if (bridge.initialIdentifier !== undefined) {
    values[loadStorageKey(windowId)] = { identifier: bridge.initialIdentifier };
  }
  let generation = 0;
  let disposed = false;
  let background: ViewerBackground = 'white';
  const refresh = async (): Promise<{ refreshed: boolean }> => {
    if (disposed) return { refreshed: false };
    const request = ++generation;
    const payload = await bridge.scan();
    if (disposed || request !== generation || payload.tabId !== bridge.itemId) {
      return { refreshed: false };
    }
    const key = scanStorageKey(windowId);
    values[key] = payload;
    for (const listener of listeners) listener({ [key]: { newValue: payload } }, 'session');
    return { refreshed: true };
  };
  return {
    windows: { getCurrent: () => Promise.resolve({ id: windowId }) },
    tabs: { query: () => Promise.resolve([{ id: bridge.itemId }]) },
    runtime: {
      sendMessage: async (message: unknown): Promise<{ refreshed: boolean }> => {
        const parsed = parseSidePanelTabActivatedMessage(message);
        if (parsed?.windowId !== windowId || parsed.tabId !== bridge.itemId) {
          return { refreshed: false };
        }
        return refresh();
      },
    },
    storage: {
      local: {
        get: (keys: string[]): Promise<Record<string, unknown>> => Promise.resolve().then(() => {
          if (!keys.includes(VIEWER_BACKGROUND_STORAGE_KEY)) return {};
          const stored = bridge.getViewerBackground?.();
          if (stored === 'white' || stored === 'black') background = stored;
          return { [VIEWER_BACKGROUND_STORAGE_KEY]: background };
        }),
        set: (preferences: Record<string, unknown>): Promise<void> => Promise.resolve().then(() => {
          if (!(VIEWER_BACKGROUND_STORAGE_KEY in preferences)) return;
          const next = preferences[VIEWER_BACKGROUND_STORAGE_KEY];
          if (next !== 'white' && next !== 'black') {
            throw new Error('Invalid viewer background preference.');
          }
          bridge.setViewerBackground?.(next);
          background = next;
        }),
      },
      onChanged: {
        addListener: (listener: StorageListener): void => { listeners.add(listener); },
        removeListener: (listener: StorageListener): void => { listeners.delete(listener); },
      },
      session: {
        get: (keys: string[]): Promise<Record<string, unknown>> => Promise.resolve(
          Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]])),
        ),
        remove: (key: string): Promise<void> => {
          delete values[key];
          return Promise.resolve();
        },
      },
    },
    refresh,
    dispose: (): void => { disposed = true; generation++; listeners.clear(); },
  };
}

type BrowserShim = ReturnType<typeof createZoteroBrowserShim>;
let active: BrowserShim | undefined;

export function initializeZoteroBrowser(bridge: ZoteroPanelBridge): BrowserShim {
  active?.dispose();
  active = createZoteroBrowserShim(bridge);
  return active;
}

/** Forward lazily: imports are evaluated before the bridge is initialized. */
export const browser = new Proxy({} as BrowserShim, {
  get: (_target, property: keyof BrowserShim) => {
    if (active === undefined) throw new Error('The Zotero bridge has not been initialized.');
    return active[property];
  },
});
