// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';

import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { Structure } from 'molstar/lib/mol-model/structure.js';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif.js';
import { describe, expect, it } from 'vitest';

import { extractMolstarMetadata } from '../../src/viewer/molstarMetadata';

describe('extractMolstarMetadata', () => {
  it('maps canonical sequence, author numbering, and ligands from mmCIF', async () => {
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

    const trajectory = await trajectoryFromMmCIF(block).run();
    const structure = Structure.ofModel(trajectory.representative);
    const metadata = extractMolstarMetadata(structure, {
      kind: 'local',
      name: 'minimal.cif',
    });

    expect(metadata.atomCount).toBe(6);
    expect(metadata.chains).toHaveLength(1);
    expect(metadata.chains[0]).toMatchObject({
      authId: 'A',
      entityId: '1',
      labelId: 'A',
      polymerType: 'polypeptide(L)',
      residues: [
        {
          authNumber: 5,
          compId: 'ALA',
          isObserved: true,
          labelNumber: 1,
        },
        {
          authNumber: 6,
          compId: 'GLY',
          insertionCode: 'A',
          isObserved: true,
          labelNumber: 2,
        },
      ],
    });
    expect(metadata.ligands).toEqual([
      expect.objectContaining({
        chainIds: ['B'],
        compId: 'ATP',
        count: 1,
        kind: 'ion',
      }),
    ]);
  });
});
