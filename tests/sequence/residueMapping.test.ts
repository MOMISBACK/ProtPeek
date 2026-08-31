// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { mapStructureSequence } from '../../src/sequence/residueMapping';

describe('mapStructureSequence', () => {
  it('preserves canonical gaps and author numbering', () => {
    const result = mapStructureSequence(
      'A',
      [
        { code: 'M', compId: 'MET', labelNumber: 1 },
        { code: 'G', compId: 'GLY', labelNumber: 2 },
        { code: 'C', compId: 'CYS', labelNumber: 3 },
      ],
      [
        {
          authNumber: -2,
          chainId: 'A',
          code: 'M',
          compId: 'MET',
          labelNumber: 1,
        },
        {
          authNumber: 8,
          chainId: 'A',
          code: 'C',
          compId: 'CYS',
          insertionCode: 'A',
          labelNumber: 3,
        },
      ],
    );

    expect(result).toEqual([
      expect.objectContaining({ authNumber: -2, isObserved: true, labelNumber: 1 }),
      expect.objectContaining({ isObserved: false, labelNumber: 2 }),
      expect.objectContaining({
        authNumber: 8,
        insertionCode: 'A',
        isObserved: true,
        labelNumber: 3,
      }),
    ]);
  });

  it('retains observed residues without a label sequence number', () => {
    const [residue] = mapStructureSequence('B', [], [
      { authNumber: 501, chainId: 'B', code: 'X', compId: 'MSE' },
    ]);
    expect(residue).toMatchObject({ authNumber: 501, chainId: 'B' });
  });
});
