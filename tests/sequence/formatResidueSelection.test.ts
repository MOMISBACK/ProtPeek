// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { formatResidueSelection, residueTargetKey } from '../../src/sequence/formatResidueSelection';
import { parseResidueSelection } from '../../src/sequence/residueSelectionParser';
import { resolveResidueSelection } from '../../src/sequence/resolveResidueSelection';
import type { ChainInfo } from '../../src/structures/types';

const chains: ChainInfo[] = [
  {
    authId: 'A', entityDescription: '', entityId: '1', labelId: 'A',
    polymerType: 'polypeptide(L)',
    residues: [5, 7, 8, 9, 10, 11, 12].map((number) => ({
      authNumber: number, chainId: 'A', code: 'A', compId: 'ALA',
      insertionCode: '', isObserved: true, labelNumber: number,
    })).concat([{
      authNumber: 11, chainId: 'A', code: 'G', compId: 'GLY',
      insertionCode: 'A', isObserved: true, labelNumber: 13,
    }]),
  },
  {
    authId: 'B', entityDescription: '', entityId: '2', labelId: 'B',
    polymerType: 'polypeptide(L)',
    residues: [{ authNumber: 3, chainId: 'B', code: 'A', compId: 'ALA',
      insertionCode: '', isObserved: true, labelNumber: 1 }],
  },
];

describe('formatResidueSelection', () => {
  it('formats single and consecutive residues and multiple chains compactly', () => {
    expect(formatResidueSelection([], chains)).toBe('');
    const input = [
      { chainId: 'A', number: 5 },
      { chainId: 'A', number: 9 },
      { chainId: 'A', number: 7 },
      { chainId: 'A', number: 8 },
      { chainId: 'A', number: 7 },
      { chainId: 'B', number: 3 },
    ];
    expect(formatResidueSelection(input, chains)).toBe('A:5,7-9,B:3');
  });

  it('never creates a range that accidentally selects an insertion code', () => {
    const selected = [
      { chainId: 'A', number: 10 },
      { chainId: 'A', number: 11 },
      { chainId: 'A', number: 12 },
    ];
    expect(formatResidueSelection(selected, chains)).toBe('A:10,11,12');
    const withInsertion = [
      { chainId: 'A', number: 10 },
      { chainId: 'A', number: 11, insertionCode: 'A' },
      { chainId: 'A', number: 12 },
    ];
    expect(formatResidueSelection(withInsertion, chains)).toBe('A:10,11A,12');
  });

  it('round-trips insertion codes and mixed chains without losing targets', () => {
    const selected = [
      { chainId: 'A', number: 11, insertionCode: 'A' },
      { chainId: 'B', number: 3 },
      { chainId: 'A', number: 9 },
      { chainId: 'A', number: 8 },
      { chainId: 'A', number: 7 },
    ];
    const formatted = formatResidueSelection(selected, chains);
    const parsed = resolveResidueSelection(parseResidueSelection(formatted), chains);
    expect(new Set(parsed.map(residueTargetKey))).toEqual(
      new Set(selected.map(residueTargetKey)),
    );
  });
});
