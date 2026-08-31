// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { identifierFromContextMenuSelection } from '../../src/extension/contextMenuSelection';

describe('identifierFromContextMenuSelection', () => {
  it.each([
    ['1CRN', '1crn'],
    [' pdb_1000AXYZ ', 'pdb_1000axyz'],
    ['P69905', 'P69905'],
    ['af-q9y261-f2', 'AF-Q9Y261-F2'],
    ['PDB 8XYZ', '8xyz'],
    ['PDB: 1ABC', '1abc'],
  ])('accepts the deliberate selection %s', (selection, expected) => {
    expect(identifierFromContextMenuSelection(selection)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'ordinary article prose',
    '1ABC, 2XYZ',
    'x'.repeat(513),
  ])('rejects a non-identifier selection', (selection) => {
    expect(identifierFromContextMenuSelection(selection)).toBeNull();
  });
});
