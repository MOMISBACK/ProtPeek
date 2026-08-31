// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { uniqueChains } from '../../src/sequence/chainModel';

describe('uniqueChains', () => {
  it('deduplicates assembly copies without merging distinct label chains', () => {
    expect(
      uniqueChains([
        { authId: 'A', entityId: '1', labelId: 'A', operatorName: '1_555' },
        { authId: 'A', entityId: '1', labelId: 'A', operatorName: '2_555' },
        { authId: 'A', entityId: '1', labelId: 'B', operatorName: '1_555' },
      ]),
    ).toHaveLength(2);
  });
});
