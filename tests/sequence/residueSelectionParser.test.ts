// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  parseResidueSelection,
  ResidueSelectionParseError,
  type ResidueSelectionParseErrorCode,
} from '../../src/sequence';

describe('parseResidueSelection', () => {
  it('parses a bare residue number', () => {
    expect(parseResidueSelection('254')).toEqual([
      { kind: 'residue', residue: { number: 254 } },
    ]);
  });

  it('parses an amino-acid code without treating it as a chain', () => {
    expect(parseResidueSelection('C254')).toEqual([
      {
        kind: 'residue',
        residue: { number: 254, residueCode: 'C' },
      },
    ]);
  });

  it('parses an explicit chain', () => {
    expect(parseResidueSelection('A:254')).toEqual([
      { kind: 'residue', chainId: 'A', residue: { number: 254 } },
    ]);
  });

  it('parses a chain and amino-acid code together', () => {
    expect(parseResidueSelection('A:C254')).toEqual([
      {
        kind: 'residue',
        chainId: 'A',
        residue: { number: 254, residueCode: 'C' },
      },
    ]);
  });

  it('inherits the last explicit chain across list terms', () => {
    expect(parseResidueSelection('A:254,278,281')).toEqual([
      { kind: 'residue', chainId: 'A', residue: { number: 254 } },
      { kind: 'residue', chainId: 'A', residue: { number: 278 } },
      { kind: 'residue', chainId: 'A', residue: { number: 281 } },
    ]);
  });

  it('changes inherited chain when another prefix appears', () => {
    expect(parseResidueSelection('254,a:278,b:c281,282')).toEqual([
      { kind: 'residue', residue: { number: 254 } },
      { kind: 'residue', chainId: 'A', residue: { number: 278 } },
      {
        kind: 'residue',
        chainId: 'B',
        residue: { number: 281, residueCode: 'C' },
      },
      { kind: 'residue', chainId: 'B', residue: { number: 282 } },
    ]);
  });

  it('keeps ranges compact', () => {
    expect(parseResidueSelection('A:254-281')).toEqual([
      {
        kind: 'range',
        chainId: 'A',
        start: { number: 254 },
        end: { number: 281 },
      },
    ]);
  });

  it('supports residue codes at either range endpoint', () => {
    expect(parseResidueSelection('a:c254-w281')).toEqual([
      {
        kind: 'range',
        chainId: 'A',
        start: { number: 254, residueCode: 'C' },
        end: { number: 281, residueCode: 'W' },
      },
    ]);
  });

  it('is case-insensitive and supports multi-character chain IDs', () => {
    expect(parseResidueSelection('auth_1:c254')).toEqual([
      {
        kind: 'residue',
        chainId: 'AUTH_1',
        residue: { number: 254, residueCode: 'C' },
      },
    ]);
  });

  it('allows surrounding whitespace and author numbering at or below zero', () => {
    expect(parseResidueSelection(' a : -5--1 , 0 ')).toEqual([
      {
        kind: 'range',
        chainId: 'A',
        start: { number: -5 },
        end: { number: -1 },
      },
      { kind: 'residue', chainId: 'A', residue: { number: 0 } },
    ]);
  });

  it.each([
    ['', 'empty-selection'],
    ['  ', 'empty-selection'],
    ['254,', 'empty-term'],
    [',254', 'empty-term'],
    [':254', 'invalid-chain'],
    ['A::254', 'invalid-chain'],
    ['A B:254', 'invalid-chain'],
    ['A:', 'invalid-residue'],
    ['CY254', 'invalid-residue'],
    ['A:foo', 'invalid-residue'],
    ['A:254;278', 'invalid-residue'],
    ['A:281-254', 'descending-range'],
    ['9007199254740992', 'invalid-residue'],
  ] as const)('rejects %s with %s', (input, code) => {
    let error: unknown;
    try {
      parseResidueSelection(input);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ResidueSelectionParseError);
    expect((error as ResidueSelectionParseError).code).toBe(
      code satisfies ResidueSelectionParseErrorCode,
    );
  });

  it('reports the zero-based term containing the error', () => {
    expect(() => parseResidueSelection('A:254,278,nope')).toThrowError(
      expect.objectContaining({ termIndex: 2, code: 'invalid-residue' }),
    );
  });
});

