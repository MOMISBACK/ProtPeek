// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  ArticleStructureScanner,
  detectPdbIdentifiersInText,
  detectPdbIdentifiersInTrustedValue,
  detectPdbIdentifiersInUrl,
  type ArticlePageSnapshot,
} from '../../src/article';

function ids(snapshot: ArticlePageSnapshot): string[] {
  return new ArticleStructureScanner()
    .scan(snapshot)
    .map(({ id }) => id);
}

describe('contextual PDB text detection', () => {
  it.each([
    ['PDB 8XYZ', ['8xyz']],
    ['PDB: 8XYZ', ['8xyz']],
    ['PDB ID 8XYZ', ['8xyz']],
    ['PDB accession 8XYZ', ['8xyz']],
    ['Protein Data Bank 8XYZ', ['8xyz']],
    ['RCSB PDB entry: 8xyz', ['8xyz']],
    ['PDBe code # 7ABC', ['7abc']],
    ['pdb IDs: 8XYZ, 8XYW and 7ABC', ['8xyz', '8xyw', '7abc']],
  ])('finds contextual IDs in %s', (text, expected) => {
    expect(
      detectPdbIdentifiersInText(text).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it('detects extended identifiers without requiring a label', () => {
    expect(
      ids({
        text: 'Models pdb_00008xyz and PDB_1000AXYZ were compared.',
      }),
    ).toEqual(['pdb_00008xyz', 'pdb_1000axyz']);
  });

  it.each([
    'The sample 8XYZ was recorded.',
    'Copyright 2024, all rights reserved.',
    'The token prefix8XYZsuffix is unrelated.',
    'PDB proteins are discussed before unrelated sample 8XYZ.',
    'PDB database release notes from 2024.',
    'notpdb_00001abc',
    'pdb_00001abc_extra',
    'pdb_00001ab!',
  ])('does not use a permissive four-character scan: %s', (text) => {
    expect(ids({ text })).toEqual([]);
  });

  it('preserves textual order across contextual and extended forms', () => {
    expect(
      ids({ text: 'PDB 8XYZ precedes pdb_1000axyz and PDB 7ABC.' }),
    ).toEqual(['8xyz', 'pdb_1000axyz', '7abc']);
  });

  it('deduplicates case and equivalent extended legacy forms', () => {
    expect(
      ids({ text: 'PDB 1ABC, 1abc and pdb_00001abc; PDB: 1ABC.' }),
    ).toEqual(['1abc']);
  });
});

describe('trusted PDB links', () => {
  it.each([
    ['https://www.rcsb.org/structure/8XYZ', ['8xyz']],
    ['https://files.rcsb.org/download/8xyz.cif', ['8xyz']],
    ['https://www.ebi.ac.uk/pdbe/entry/pdb/7ABC', ['7abc']],
    ['https://www.ebi.ac.uk/pdbe/entry-files/download/7abc.cif', ['7abc']],
    ['https://www.wwpdb.org/pdb?id=8xyz', ['8xyz']],
    [
      'https://files.wwpdb.org/pub/pdb/data/structures/divided/mmCIF/xy/8xyz.cif.gz',
      ['8xyz'],
    ],
    ['https://models.rcsb.org/pdb_1000axyz.bcif', ['pdb_1000axyz']],
  ])('extracts official URL %s', (url, expected) => {
    expect(
      detectPdbIdentifiersInUrl(url).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it.each([
    'https://example.test/structure/8XYZ',
    'https://rcsb.org.evil.test/structure/8XYZ',
    'https://www.ebi.ac.uk/uniprot/8XYZ',
    'not a URL containing 8XYZ',
  ])('ignores untrusted or irrelevant URL %s', (url) => {
    expect(detectPdbIdentifiersInUrl(url)).toEqual([]);
  });

  it('resolves an official relative URL against the page URL', () => {
    expect(
      detectPdbIdentifiersInUrl(
        '/structure/8XYZ',
        'https://www.rcsb.org/search',
      )[0]?.canonicalValue,
    ).toBe('8xyz');
  });

  it('uses official destinations and their compact anchor labels', () => {
    const detections = new ArticleStructureScanner().scan({
      links: [
        {
          href: 'https://www.rcsb.org/structure/8XYZ',
          text: '8XYZ',
        },
        {
          href: 'https://example.test/7ABC',
          text: '7ABC',
        },
      ],
    });

    expect(detections).toEqual([
      {
        id: '8xyz',
        displayId: '8XYZ',
        format: 'legacy',
        sources: ['link'],
      },
    ]);
  });
});

describe('metadata and structured data scanning', () => {
  it('accepts bare IDs only in explicitly structural metadata', () => {
    expect(
      ids({
        metadata: [
          { name: 'citation_pdb', content: '8XYZ, 7ABC' },
          { property: 'og:title', content: 'Study cohort 6ABC' },
        ],
      }),
    ).toEqual(['8xyz', '7abc']);
  });

  it('still recognizes contextual values and official URLs in generic metadata', () => {
    expect(
      ids({
        metadata: [
          { name: 'description', content: 'The PDB entry is 8XYZ' },
          {
            property: 'og:url',
            content: 'https://www.rcsb.org/structure/7ABC',
          },
        ],
      }),
    ).toEqual(['8xyz', '7abc']);
  });

  it('uses structural JSON-LD keys but ignores arbitrary bare tokens', () => {
    expect(
      ids({
        structuredData: [
          {
            name: 'Cohort 8XYZ',
            pdbIds: ['8XYZ', 'pdb_1000axyz'],
            nested: { description: 'Protein Data Bank: 7ABC' },
          },
        ],
      }),
    ).toEqual(['8xyz', 'pdb_1000axyz', '7abc']);
  });

  it('also accepts a raw serialized JSON-LD script', () => {
    expect(
      ids({
        structuredData: [
          JSON.stringify({ pdbIds: ['8XYZ', 'pdb_1000axyz'] }),
        ],
      }),
    ).toEqual(['8xyz', 'pdb_1000axyz']);
  });

  it('handles cyclic or excessively nested non-JSON input defensively', () => {
    const cyclic: { self?: unknown; pdb: string } = { pdb: '8XYZ' };
    cyclic.self = cyclic;

    expect(ids({ structuredData: [cyclic] })).toEqual(['8xyz']);
  });

  it('collects each source once while deduplicating the identifier', () => {
    expect(
      new ArticleStructureScanner().scan({
        text: 'PDB: 8XYZ',
        url: 'https://www.rcsb.org/structure/8XYZ',
        links: [
          { href: 'https://www.ebi.ac.uk/pdbe/entry/pdb/8xyz' },
          { href: 'https://www.rcsb.org/structure/8XYZ' },
        ],
        metadata: [{ name: 'pdb', content: '8XYZ' }],
        structuredData: [{ pdbId: '8XYZ' }],
      }),
    ).toEqual([
      {
        id: '8xyz',
        displayId: '8XYZ',
        format: 'legacy',
        sources: [
          'text',
          'page-url',
          'link',
          'metadata',
          'structured-data',
        ],
      },
    ]);
  });

  it('returns no detections for an empty snapshot', () => {
    expect(new ArticleStructureScanner().scan({})).toEqual([]);
  });
});

describe('trusted compact values', () => {
  it.each([
    ['8XYZ', ['8xyz']],
    ['8XYZ / 7ABC', ['8xyz', '7abc']],
    ['pdb_1000axyz; 8XYZ', ['pdb_1000axyz', '8xyz']],
  ])('parses the complete list %s', (value, expected) => {
    expect(
      detectPdbIdentifiersInTrustedValue(value).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it.each(['Study 8XYZ', '2024 dataset', '8XYZ trailing words', '8XYZ, nope'])(
    'rejects non-list metadata content: %s',
    (value) => {
      expect(detectPdbIdentifiersInTrustedValue(value)).toEqual([]);
    },
  );
});
