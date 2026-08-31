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
    };

    expect(
      articleStructuresFromScanResult([
        valid,
        { ...valid, format: 'unknown' },
        { ...valid, sources: ['host-page-value'] },
        null,
      ]),
    ).toEqual([valid]);
  });

  it.each([undefined, null, {}, '1crn'])(
    'turns a non-array scripting result into an empty list',
    (value) => {
      expect(articleStructuresFromScanResult(value)).toEqual([]);
    },
  );
});
