// SPDX-License-Identifier: MPL-2.0
import type { ViewerBackground } from '../viewer/StructureViewer';

export const ZOTERO_VIEWER_BACKGROUND_PREF = 'extensions.protpeek.viewerBackground';

export interface ZoteroPreferenceHost {
  get(key: string, global: boolean): unknown;
  set(key: string, value: string, global: boolean): void;
  clear(key: string, global: boolean): void;
}

/** Keep Zotero.Prefs in the privileged host; expose only this preference. */
export function createZoteroBackgroundPreference(prefs: ZoteroPreferenceHost) {
  return {
    getViewerBackground: (): ViewerBackground => {
      const value = prefs.get(ZOTERO_VIEWER_BACKGROUND_PREF, true);
      return value === 'black' ? 'black' : 'white';
    },
    setViewerBackground: (background: ViewerBackground): void => {
      if (background !== 'white' && background !== 'black') {
        throw new Error('Invalid viewer background preference.');
      }
      // Zotero preserves the type of an existing pref. Repair a manually
      // altered boolean/integer pref before saving this string preference.
      const previous = prefs.get(ZOTERO_VIEWER_BACKGROUND_PREF, true);
      if (previous !== undefined && typeof previous !== 'string') {
        prefs.clear(ZOTERO_VIEWER_BACKGROUND_PREF, true);
      }
      prefs.set(ZOTERO_VIEWER_BACKGROUND_PREF, background, true);
    },
  };
}
