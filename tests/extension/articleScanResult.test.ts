// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { articleStructuresFromScanResult } from '../../src/extension/articleScanResult';

describe('articleStructuresFromScanResult', () => {
  it('keeps only serializable article detections with known fields', () => {
    const valid = {
      displayId: '1CRN',
      format: 'legacy',
      id: '1crn',
      sources: ['text', 'metadata'],
      type: 'pdb',
    };

    expect(
      articleStructuresFromScanResult([
        valid,
        { ...valid, format: 'unknown' },
        { ...valid, type: 'uniprot' },
        { ...valid, sources: ['host-page-value'] },
        null,
      ]),
    ).toEqual([valid]);
  });

  it('validates UniProt and AlphaFold detections by canonical type and shape', () => {
    const uniprot = {
      displayId: 'P69905',
      id: 'P69905',
      sources: ['metadata'],
      type: 'uniprot',
    };
    const alphafold = {
      displayId: 'AF-Q9Y261-F1',
      id: 'AF-Q9Y261-F1',
      sources: ['link'],
      type: 'alphafold',
    };

    expect(
      articleStructuresFromScanResult([
        uniprot,
        alphafold,
        { ...uniprot, displayId: 'p69905' },
        { ...uniprot, format: 'legacy' },
        { ...alphafold, id: 'Q9Y261' },
        { ...alphafold, type: 'uniprot' },
      ]),
    ).toEqual([uniprot, alphafold]);
  });

  it.each([undefined, null, {}, '1crn'])(
    'turns a non-array scripting result into an empty list',
    (value) => {
      expect(articleStructuresFromScanResult(value)).toEqual([]);
    },
  );
});
