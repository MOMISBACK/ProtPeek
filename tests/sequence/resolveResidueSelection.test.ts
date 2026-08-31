// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { parseResidueSelection } from '../../src/sequence/residueSelectionParser';
import { resolveResidueSelection } from '../../src/sequence/resolveResidueSelection';
import type { ChainInfo } from '../../src/structures/types';

const chains: ChainInfo[] = [
  {
    authId: 'A',
    entityDescription: 'Test chain',
    entityId: '1',
    labelId: 'A',
    polymerType: 'polypeptide(L)',
    residues: [
      { authNumber: 10, chainId: 'A', code: 'C', compId: 'CYS', insertionCode: '', isObserved: true, labelNumber: 1 },
      { authNumber: 11, chainId: 'A', code: 'G', compId: 'GLY', insertionCode: '', isObserved: true, labelNumber: 2 },
      { authNumber: 11, chainId: 'A', code: 'S', compId: 'SER', insertionCode: 'A', isObserved: true, labelNumber: 3 },
      { chainId: 'A', code: 'A', compId: 'ALA', insertionCode: '', isObserved: false, labelNumber: 4 },
      { authNumber: 14, chainId: 'A', code: 'W', compId: 'TRP', insertionCode: '', isObserved: true, labelNumber: 5 },
    ],
  },
];

describe('resolveResidueSelection', () => {
  it('validates residue codes against observed author numbering', () => {
    expect(
      resolveResidueSelection(parseResidueSelection('C10'), chains),
    ).toEqual([{ chainId: 'A', number: 10 }]);
    expect(() =>
      resolveResidueSelection(parseResidueSelection('G10'), chains),
    ).toThrow('Residue A:10 is not G');
  });

  it('resolves ranges to observed residues and preserves insertion codes', () => {
    expect(
      resolveResidueSelection(parseResidueSelection('A:10-14'), chains),
    ).toEqual([
      { chainId: 'A', number: 10 },
      { chainId: 'A', number: 11 },
      { chainId: 'A', insertionCode: 'A', number: 11 },
      { chainId: 'A', number: 14 },
    ]);
  });

  it('rejects missing chains, unobserved residues, and empty ranges', () => {
    expect(() =>
      resolveResidueSelection(parseResidueSelection('B:10'), chains),
    ).toThrow('Chain B is not present');
    expect(() =>
      resolveResidueSelection(parseResidueSelection('12'), chains),
    ).toThrow('Residue A:12 is not observed');
    expect(() =>
      resolveResidueSelection(parseResidueSelection('A:20-30'), chains),
    ).toThrow('No observed residues');
  });

  it('requires a chain when more than one chain exists', () => {
    const second = { ...chains[0], authId: 'B', labelId: 'B' } as ChainInfo;
    expect(() =>
      resolveResidueSelection(parseResidueSelection('10'), [chains[0]!, second]),
    ).toThrow('Specify a chain');
  });

  it('caps expanded observed selections and deduplicates repeated terms', () => {
    expect(
      resolveResidueSelection(parseResidueSelection('A:10,A:10'), chains),
    ).toEqual([{ chainId: 'A', number: 10 }]);
    expect(() =>
      resolveResidueSelection(parseResidueSelection('A:10-14'), chains, 2),
    ).toThrow('selection is too large');
  });
});
