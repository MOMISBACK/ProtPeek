// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  AlphaFoldIdentifier,
  parseStructureIdentifier,
  PdbIdentifier,
  UniProtIdentifier,
} from '../../src/structures/identifiers';

describe('PdbIdentifier', () => {
  it.each([
    ['1ABC', '1abc', '1ABC', 'legacy'],
    ['8xyz', '8xyz', '8XYZ', 'legacy'],
    ['0aB9', '0ab9', '0AB9', 'legacy'],
    ['pdb_00001abc', 'pdb_00001abc', 'pdb_00001abc', 'extended'],
    ['PDB_1000AXYZ', 'pdb_1000axyz', 'pdb_1000axyz', 'extended'],
  ] as const)(
    'normalizes %s',
    (input, canonicalValue, displayValue, format) => {
      const identifier = PdbIdentifier.parse(input);

      expect(identifier).not.toBeNull();
      expect(identifier?.canonicalValue).toBe(canonicalValue);
      expect(identifier?.displayValue).toBe(displayValue);
      expect(identifier?.format).toBe(format);
      expect(identifier?.toString()).toBe(canonicalValue);
      expect(identifier?.toJSON()).toBe(canonicalValue);
    },
  );

  it('trims surrounding whitespace', () => {
    expect(PdbIdentifier.parse('  8XYZ\n')?.canonicalValue).toBe('8xyz');
  });

  it.each([
    '',
    'ABC',
    'ABCD',
    '1ABC5',
    '11-3',
    'pdb_1abc',
    'pdb_0001abc',
    'pdb_000001abc',
    'pdb_0000-abc',
    'pdb 00001abc',
    'pdb_00001abç',
  ])('rejects invalid syntax: %s', (input) => {
    expect(PdbIdentifier.parse(input)).toBeNull();
    expect(PdbIdentifier.isValid(input)).toBe(false);
  });

  it('throws from the strict constructor helper', () => {
    expect(() => PdbIdentifier.from('not-an-id')).toThrow(TypeError);
  });

  it('recognizes equivalent legacy and extended spellings', () => {
    const legacy = PdbIdentifier.from('1ABC');
    const extended = PdbIdentifier.from('pdb_00001abc');
    const future = PdbIdentifier.from('pdb_1000axyz');

    expect(legacy.isEquivalentTo(extended)).toBe(true);
    expect(extended.identityKey).toBe('1abc');
    expect(extended.legacyEquivalent?.canonicalValue).toBe('1abc');
    expect(legacy.legacyEquivalent).toBe(legacy);
    expect(future.legacyEquivalent).toBeNull();
  });
});

describe('UniProtIdentifier', () => {
  it.each(['P69905', 'q9Y261', 'A2BC19', 'A0A023GPI8'])(
    'accepts official accession shape %s',
    (input) => {
      expect(UniProtIdentifier.parse(input)?.canonicalValue).toBe(
        input.toUpperCase(),
      );
    },
  );

  it.each([
    '',
    'P6990',
    'P699055',
    'A12345',
    'P69-05',
    'A0A023GPI',
    'A0A023GPI88',
  ])('rejects invalid accession syntax: %s', (input) => {
    expect(UniProtIdentifier.parse(input)).toBeNull();
  });
});

describe('AlphaFoldIdentifier', () => {
  it.each([
    ['AF-P69905-F1', 'AF-P69905-F1', 1],
    ['af-q9y261-f2', 'AF-Q9Y261-F2', 2],
    ['AF-A0A023GPI8-F12', 'AF-A0A023GPI8-F12', 12],
  ] as const)('normalizes %s', (input, canonicalValue, fragment) => {
    const identifier = AlphaFoldIdentifier.parse(input);

    expect(identifier?.canonicalValue).toBe(canonicalValue);
    expect(identifier?.fragment).toBe(fragment);
    expect(identifier?.accession.canonicalValue).toBe(
      canonicalValue.split('-')[1],
    );
  });

  it.each([
    'P69905',
    'AF-P69905',
    'AF-P69905-F0',
    'AF-P69905-F-1',
    'AF-NOTONE-F1',
    'AF-P69905-F1-model_v4',
  ])('rejects invalid AlphaFold ID syntax: %s', (input) => {
    expect(AlphaFoldIdentifier.parse(input)).toBeNull();
  });
});

describe('parseStructureIdentifier', () => {
  it.each([
    ['8xyz', 'pdb', '8xyz'],
    ['pdb_1000axyz', 'pdb', 'pdb_1000axyz'],
    ['P69905', 'uniprot', 'P69905'],
    ['a0a023gpi8', 'uniprot', 'A0A023GPI8'],
    ['AF-P69905-F1', 'alphafold', 'AF-P69905-F1'],
    ['PDB: 1ABC', 'pdb', '1abc'],
    ['UniProt accession: p69905', 'uniprot', 'P69905'],
    ['AlphaFold ID: af-p69905-f1', 'alphafold', 'AF-P69905-F1'],
  ] as const)('detects %s as %s', (input, type, canonicalValue) => {
    const identifier = parseStructureIdentifier(input);

    expect(identifier?.type).toBe(type);
    expect(identifier?.canonicalValue).toBe(canonicalValue);
  });

  it.each([
    '',
    'unknown',
    'PDB: P69905',
    'UniProt: 8XYZ',
    'AlphaFold: P69905',
  ])('does not guess invalid or explicitly mismatched values: %s', (input) => {
    expect(parseStructureIdentifier(input)).toBeNull();
  });
});

