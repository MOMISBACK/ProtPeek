// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  MolstarComponentTag,
  hasMolstarTag,
} from '../../src/viewer/molstarState';

describe('molstarState', () => {
  it('matches Molstar transform tags instead of hierarchy keys', () => {
    const tags = ['structure-component-static-polymer'];

    expect(hasMolstarTag(tags, MolstarComponentTag.polymer)).toBe(true);
    expect(hasMolstarTag(tags, MolstarComponentTag.water)).toBe(false);
    expect(hasMolstarTag(undefined, MolstarComponentTag.polymer)).toBe(false);
  });

  it('supports custom component tags and readonly sets', () => {
    const tags = new Set<string>([
      MolstarComponentTag.selection,
      'structure-component-protpeek-selection',
    ]);

    expect(hasMolstarTag(tags, MolstarComponentTag.selection)).toBe(true);
    expect(hasMolstarTag(tags, MolstarComponentTag.isolate)).toBe(false);
  });
});
