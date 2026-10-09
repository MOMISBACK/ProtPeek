// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  ArticleStructureScanner,
  detectPdbIdentifiersInText,
  detectPdbIdentifiersInTrustedValue,
  detectPdbIdentifiersInUrl,
  detectProteinIdentifiersInText,
  detectProteinIdentifiersInUrl,
  detectUniProtIdentifiersInTrustedValue,
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
    ['PDB accession number: 1AON', ['1aon']],
    ['PDB accession codes: 1AON and 1GRL', ['1aon', '1grl']],
    ['PDB under accession code 1AON', ['1aon']],
    ['PDB with accession code 1AON', ['1aon']],
    ['wwPDB entry 1AON', ['1aon']],
    ['Protein Data Bank 8XYZ', ['8xyz']],
    ['RCSB PDB entry: 8xyz', ['8xyz']],
    ['PDBe code # 7ABC', ['7abc']],
    ['pdb IDs: 8XYZ, 8XYW and 7ABC', ['8xyz', '8xyw', '7abc']],
    ['PDB entries 1AON, 1CRN, and 1GRL', ['1aon', '1crn', '1grl']],
    ['PDB codes 1AON or 1GRL', ['1aon', '1grl']],
    ['PDB entries 1AON (apo), 1CRN (ATP) and 1GRL (ADP)', ['1aon', '1crn', '1grl']],
    ['PDB entries 1AON [apo], 1GRL [ATP]', ['1aon', '1grl']],
    ['PDB IDs: (1AON), (1CRN), and (1GRL)', ['1aon', '1crn', '1grl']],
    ['PDB entries are 1AON, pdb_1000axyz and 1GRL', ['1aon', 'pdb_1000axyz', '1grl']],
    ['The structure 1AON (PDB) was used.', ['1aon']],
    ['Structures 1AON, 1GRL (PDB IDs) were compared.', ['1aon', '1grl']],
    ['Structures 1AON (apo), 1GRL (ATP) (PDB entries) were compared.', ['1aon', '1grl']],
    ['Structure 1AON [Protein Data Bank] was used.', ['1aon']],
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
    'PDB accession numbers were assigned to sample 1AON.',
    'The unrelated sample prefix1AON (PDB) was recorded.',
    'The unrelated sample 1AON_extra (PDB) was recorded.',
    'PDB entries 1AONsuffix and 1GRL were recorded.',
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

  it.each([
    'PDB 1AON was compared with sample 1GRL.',
    'PDB 1AON (apo) was compared with sample 1GRL.',
    'PDB 1AON, unrelated sample 1GRL.',
    'PDB 1AON. Sample 1GRL was measured separately.',
    'PDB 1AON (a nested description (ATP)), 1GRL.',
  ])('does not carry PDB context through arbitrary prose: %s', (text) => {
    expect(ids({ text })).toEqual(['1aon']);
  });

  it('handles a long explicit ID list without truncating it after 128 characters', () => {
    const values = Array.from({ length: 40 }, (_, index) =>
      `1${index.toString(36).padStart(3, '0')}`,
    );
    expect(ids({ text: `PDB entries ${values.join(', ')}.` })).toEqual(values);
  });

  it('does not turn a token truncated by the scan bound into a valid ID', () => {
    expect(ids({ text: `PDB${' '.repeat(1_020)}1AON_extra` })).toEqual([]);
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
    ['https://www.rcsb.org/3d-view/1AON', ['1aon']],
    ['https://files.rcsb.org/download/8xyz.cif', ['8xyz']],
    ['https://www.ebi.ac.uk/pdbe/entry/pdb/7ABC', ['7abc']],
    ['https://www.ebi.ac.uk/pdbe-srv/view/entry/1AON', ['1aon']],
    ['https://www.ebi.ac.uk/pdbe/entry-files/download/7abc.cif', ['7abc']],
    ['https://www.wwpdb.org/pdb?id=8xyz', ['8xyz']],
    [
      'https://files.wwpdb.org/pub/pdb/data/structures/divided/mmCIF/xy/8xyz.cif.gz',
      ['8xyz'],
    ],
    [
      'https://files.wwpdb.org/pub/pdb/data/structures/divided/pdb/ao/pdb1aon.ent.gz',
      ['1aon'],
    ],
    ['https://doi.org/10.2210/pdb1aon/pdb', ['1aon']],
    ['https://dx.doi.org/10.2210/PDB1AON/PDB', ['1aon']],
    ['https://doi.org/10.2210/pdb_1000axyz/pdb', ['pdb_1000axyz']],
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
    'https://www.ebi.ac.uk/pdbe-srv-unrelated/entry/1AON',
    'https://doi.org.evil.test/10.2210/pdb1aon/pdb',
    'https://doi.org/10.1000/pdb1aon/pdb',
    'https://doi.org/10.2210/pdb1aon/unrelated',
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
        type: 'pdb',
      },
    ]);
  });

  it('finds printed official links and structure DOIs in article text', () => {
    expect(ids({
      text: 'See https://www.rcsb.org/3d-view/1AON. The second entry is ' +
        '(https://www.ebi.ac.uk/pdbe-srv/view/entry/1GRL). ' +
        'Also doi:10.2210/pdb1crn/pdb and ' +
        'https://doi.org/10.2210/pdb_1000axyz/pdb.',
    })).toEqual(['1aon', '1grl', '1crn', 'pdb_1000axyz']);
  });

  it('ignores printed URL IDs on untrusted destinations', () => {
    expect(ids({
      text: 'See https://rcsb.org.evil.test/structure/1AON and ' +
        'https://example.test/structure/1GRL or 10.1000/pdb1crn/pdb.',
    })).toEqual([]);
  });

  it.each([
    'https://doi.org.evil.test/10.2210/pdb1aon/pdb',
    'https://example.test/10.2210/pdb1aon/pdb',
    'https://doi.org/10.2210/pdb1aon/pdb/unrelated',
  ])('does not reinterpret an unrecognized URL as a standalone DOI: %s', (text) => {
    expect(ids({ text })).toEqual([]);
  });

  it('collects text and link sources for the same structure DOI', () => {
    const href = 'https://doi.org/10.2210/pdb1aon/pdb';
    expect(new ArticleStructureScanner().scan({
      text: `Data are deposited at ${href}.`,
      links: [{ href }],
    })).toEqual([{
      id: '1aon',
      displayId: '1AON',
      format: 'legacy',
      sources: ['text', 'link'],
      type: 'pdb',
    }]);
  });
});

describe('contextual UniProt and explicit AlphaFold text detection', () => {
  it.each([
    ['UniProt P69905', ['P69905']],
    ['UniProt accession: q9Y261', ['Q9Y261']],
    ['UniProt accession number A2BC19', ['A2BC19']],
    ['UniProtKB ID = A0A023GPI8', ['A0A023GPI8']],
    ['Swiss-Prot entries P69905 and Q9Y261', ['P69905', 'Q9Y261']],
    ['UniProtKB/Swiss-Prot accession P69905', ['P69905']],
  ])('finds contextual accessions in %s', (text, expected) => {
    expect(
      detectProteinIdentifiersInText(text).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it('recognizes full AlphaFold IDs without requiring a label', () => {
    expect(
      ids({
        text: 'Models AF-P69905-F1 and af-a0a023gpi8-f12 were compared.',
      }),
    ).toEqual(['AF-P69905-F1', 'AF-A0A023GPI8-F12']);
  });

  it.each([
    'P69905 was measured in the cohort.',
    'The sample A2BC19 was retained.',
    'UniProt database release notes precede an unrelated sample P69905.',
    'notAF-P69905-F1',
    'prefix_AF-P69905-F1',
    'AF-P69905-F0',
    'AF-P69905-F1extra',
  ])('ignores unlabelled or malformed accession-like text: %s', (text) => {
    expect(ids({ text })).toEqual([]);
  });

  it('preserves article order across identifier databases', () => {
    expect(
      ids({
        text: 'UniProt P69905 precedes PDB 1ABC and AF-Q9Y261-F1.',
      }),
    ).toEqual(['P69905', '1abc', 'AF-Q9Y261-F1']);
  });
});

describe('trusted UniProt and AlphaFold links', () => {
  it.each([
    ['https://www.uniprot.org/uniprotkb/P69905/entry', ['P69905']],
    ['https://rest.uniprot.org/uniprotkb/Q9Y261.fasta', ['Q9Y261']],
    ['https://alphafold.ebi.ac.uk/entry/P69905', ['P69905']],
    ['https://alphafold.ebi.ac.uk/api/prediction/Q9Y261', ['Q9Y261']],
    [
      'https://alphafold.ebi.ac.uk/files/AF-P69905-F1-model_v4.cif',
      ['AF-P69905-F1'],
    ],
  ])('extracts official URL %s', (url, expected) => {
    expect(
      detectProteinIdentifiersInUrl(url).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it.each([
    'https://example.test/uniprotkb/P69905',
    'https://uniprot.org.evil.test/uniprotkb/P69905',
    'https://www.ebi.ac.uk/uniprotkb/P69905',
    'http://www.uniprot.org/uniprotkb/P69905',
    'https://alphafold.ebi.ac.uk/search/P69905',
  ])('ignores untrusted or irrelevant URL %s', (url) => {
    expect(detectProteinIdentifiersInUrl(url)).toEqual([]);
  });

  it('surfaces official link destinations as clickable detection types', () => {
    expect(
      new ArticleStructureScanner().scan({
        links: [
          {
            href: 'https://www.uniprot.org/uniprotkb/P69905/entry',
            text: 'P69905',
          },
          {
            href:
              'https://alphafold.ebi.ac.uk/files/AF-Q9Y261-F1-model_v4.cif',
          },
          { href: 'https://example.test/P12345', text: 'P12345' },
        ],
      }),
    ).toEqual([
      {
        displayId: 'P69905',
        id: 'P69905',
        sources: ['link'],
        type: 'uniprot',
      },
      {
        displayId: 'AF-Q9Y261-F1',
        id: 'AF-Q9Y261-F1',
        sources: ['link'],
        type: 'alphafold',
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
        type: 'pdb',
      },
    ]);
  });

  it('returns no detections for an empty snapshot', () => {
    expect(new ArticleStructureScanner().scan({})).toEqual([]);
  });
});

describe('trusted UniProt fields', () => {
  it('accepts bare accessions only in explicitly UniProt metadata', () => {
    expect(
      ids({
        metadata: [
          { name: 'citation_uniprot_accession', content: 'P69905; Q9Y261' },
          { property: 'protein_accession', content: 'A2BC19' },
        ],
      }),
    ).toEqual(['P69905', 'Q9Y261']);
  });

  it('uses UniProt JSON-LD keys while full AlphaFold IDs need no trusted key', () => {
    expect(
      ids({
        structuredData: [
          {
            proteinAccession: 'A2BC19',
            uniprotAccession: ['P69905', 'Q9Y261'],
            model: 'AF-A0A023GPI8-F1',
          },
        ],
      }),
    ).toEqual(['AF-A0A023GPI8-F1', 'P69905', 'Q9Y261']);
  });

  it.each([
    ['P69905', ['P69905']],
    ['P69905 / Q9Y261', ['P69905', 'Q9Y261']],
    ['A0A023GPI8; A2BC19', ['A0A023GPI8', 'A2BC19']],
  ])('parses the complete trusted value %s', (value, expected) => {
    expect(
      detectUniProtIdentifiersInTrustedValue(value).map(
        ({ canonicalValue }) => canonicalValue,
      ),
    ).toEqual(expected);
  });

  it.each([
    'Study P69905',
    'P69905 trailing words',
    'P69905, nope',
    'P69905 Q9Y261',
  ])('rejects non-list trusted content: %s', (value) => {
    expect(detectUniProtIdentifiersInTrustedValue(value)).toEqual([]);
  });
});

describe('trusted compact values', () => {
  it('rejects a long ID list followed by unrelated content', () => {
    const values = Array.from({ length: 40 }, (_, index) =>
      `1${index.toString(36).padStart(3, '0')}`,
    );
    expect(detectPdbIdentifiersInTrustedValue(
      `${values.join(', ')}, unrelated content`,
    )).toEqual([]);
  });

  it.each([
    ['8XYZ', ['8xyz']],
    ['8XYZ / 7ABC', ['8xyz', '7abc']],
    ['1AON, 1CRN, and 1GRL', ['1aon', '1crn', '1grl']],
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
