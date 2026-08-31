// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';

import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { describe, expect, it } from 'vitest';

describe('small structural fixtures', () => {
  it('parses the mmCIF fixture with the bundled Molstar parser', async () => {
    const source = await readFile(
      new URL('../fixtures/minimal.cif', import.meta.url),
      'utf8',
    );
    const parsed = await CIF.parse(source).run();

    expect(parsed.isError).toBe(false);
    if (parsed.isError) return;
    const block = parsed.result.blocks[0];
    expect(block).toBeDefined();
    if (block === undefined) return;
    const database = CIF.schema.mmCIF(block);
    expect(database.atom_site._rowCount).toBe(6);
    expect(database.entity_poly_seq._rowCount).toBe(2);
  });

  it('keeps the legacy PDB fixture deliberately tiny', async () => {
    const source = await readFile(
      new URL('../fixtures/minimal.pdb', import.meta.url),
      'utf8',
    );

    expect(source).toContain('ATOM');
    expect(source).toContain('HETATM');
    expect(source.length).toBeLessThan(1_000);
  });
});
