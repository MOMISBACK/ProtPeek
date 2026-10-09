// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import {
  createZoteroBackgroundPreference,
  ZOTERO_VIEWER_BACKGROUND_PREF,
} from '../../src/zotero/viewerBackgroundPreference';
import type { ViewerBackground } from '../../src/viewer/StructureViewer';

function host(initial: unknown) {
  let value = initial;
  return {
    get: vi.fn(() => value),
    set: vi.fn((_key: string, next: string) => { value = next; }),
    clear: vi.fn(() => { value = undefined; }),
  };
}

describe('Zotero viewer background preference', () => {
  it.each([undefined, null, 42, true, '', 'auto', 'BLACK'])('defaults an unset or malformed value (%s) to white', (value) => {
    const prefs = host(value);
    expect(createZoteroBackgroundPreference(prefs).getViewerBackground()).toBe('white');
    expect(prefs.get).toHaveBeenCalledWith(ZOTERO_VIEWER_BACKGROUND_PREF, true);
    expect(prefs.set).not.toHaveBeenCalled();
    expect(prefs.clear).not.toHaveBeenCalled();
  });

  it('uses the same single global preference when the viewer is reopened', () => {
    const prefs = host(undefined);
    createZoteroBackgroundPreference(prefs).setViewerBackground('black');
    expect(prefs.set).toHaveBeenCalledWith(ZOTERO_VIEWER_BACKGROUND_PREF, 'black', true);
    const reopened = createZoteroBackgroundPreference(prefs);
    expect(reopened.getViewerBackground()).toBe('black');
    reopened.setViewerBackground('white');
    expect(createZoteroBackgroundPreference(prefs).getViewerBackground()).toBe('white');
    expect(prefs.clear).not.toHaveBeenCalled();
  });

  it.each([17, false])('repairs a manually altered preference type (%s) before saving', (value) => {
    const prefs = host(value);
    createZoteroBackgroundPreference(prefs).setViewerBackground('black');
    expect(prefs.clear).toHaveBeenCalledWith(ZOTERO_VIEWER_BACKGROUND_PREF, true);
    expect(prefs.clear.mock.invocationCallOrder[0]).toBeLessThan(prefs.set.mock.invocationCallOrder[0]!);
    expect(createZoteroBackgroundPreference(prefs).getViewerBackground()).toBe('black');
  });

  it('rejects invalid input without reading or changing preferences', () => {
    const prefs = host('white');
    const preference = createZoteroBackgroundPreference(prefs);
    expect(() => preference.setViewerBackground('blue' as ViewerBackground)).toThrow('Invalid viewer background');
    expect(prefs.get).not.toHaveBeenCalled();
    expect(prefs.set).not.toHaveBeenCalled();
    expect(prefs.clear).not.toHaveBeenCalled();
  });
});
