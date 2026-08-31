// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { aggregateLigands } from '../../src/structures/metadata/ligands';

describe('aggregateLigands', () => {
  it('excludes water and polymers and counts residue instances', () => {
    const result = aggregateLigands([
      {
        atomCount: 1,
        chainId: 'A',
        compId: 'HOH',
        instanceId: 'A:1',
        isPolymer: false,
      },
      {
        atomCount: 31,
        chainId: 'C',
        compId: 'ATP',
        instanceId: 'C:401',
        isPolymer: false,
      },
      {
        atomCount: 31,
        chainId: 'D',
        compId: 'ATP',
        instanceId: 'D:401',
        isPolymer: false,
      },
      {
        atomCount: 1,
        chainId: 'C',
        compId: 'MG',
        instanceId: 'C:402',
        isPolymer: false,
      },
      {
        atomCount: 8,
        chainId: 'A',
        compId: 'ALA',
        instanceId: 'A:10',
        isPolymer: true,
      },
    ]);

    expect(result).toEqual([
      expect.objectContaining({ compId: 'ATP', count: 2, kind: 'cofactor' }),
      expect.objectContaining({ compId: 'MG', count: 1, kind: 'ion' }),
    ]);
  });
});
