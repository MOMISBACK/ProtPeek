// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  VIEWER_BACKGROUND_STORAGE_KEY,
  ViewerBackgroundPreference,
} from '../../src/ui/viewerBackgroundPreference';

describe('ViewerBackgroundPreference', () => {
  it('restores only valid preferences and defaults to white', async () => {
    for (const [stored, expected] of [
      ['black', 'black'], ['white', 'white'], ['dark', 'white'], [null, 'white'],
    ]) {
      const preference = new ViewerBackgroundPreference({
        get: async () => ({ [VIEWER_BACKGROUND_STORAGE_KEY]: stored }),
        set: async () => undefined,
      });
      expect(await preference.read()).toBe(expected);
    }
  });

  it('keeps a new choice when the initial read finishes late', async () => {
    let finishRead!: (value: Record<string, unknown>) => void;
    const set = vi.fn(async () => undefined);
    const preference = new ViewerBackgroundPreference({
      get: () => new Promise((resolve) => { finishRead = resolve; }),
      set,
    });
    const reading = preference.read();
    await preference.set('black');
    finishRead({ [VIEWER_BACKGROUND_STORAGE_KEY]: 'white' });
    expect(await reading).toBe('black');
    expect(set).toHaveBeenCalledWith({ [VIEWER_BACKGROUND_STORAGE_KEY]: 'black' });
  });

  it('orders saves and permits later writes after a failure', async () => {
    let finishFirst!: () => void;
    const set = vi.fn<(values: Record<string, unknown>) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; }))
      .mockRejectedValueOnce(new Error('Storage unavailable'))
      .mockResolvedValueOnce(undefined);
    const preference = new ViewerBackgroundPreference({ get: async () => ({}), set });
    const first = preference.set('black');
    const second = preference.set('white');
    const rejection = expect(second).rejects.toThrow('Storage unavailable');
    const third = preference.set('black');
    await Promise.resolve();
    await Promise.resolve();
    expect(set).toHaveBeenCalledTimes(1);
    finishFirst();
    await Promise.all([first, rejection, third]);
    expect(set.mock.calls.map(([values]) => values[VIEWER_BACKGROUND_STORAGE_KEY])).toEqual(
      ['black', 'white', 'black'],
    );
  });

  it('remains usable without browser-local storage, as in Zotero', async () => {
    const preference = new ViewerBackgroundPreference();
    expect(await preference.read()).toBe('white');
    await preference.set('black');
    expect(await preference.read()).toBe('black');
  });
});
