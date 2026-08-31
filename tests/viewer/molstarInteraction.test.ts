// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';

import { OrderedSet } from 'molstar/lib/mol-data/int.js';
import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import { EmptyLoci } from 'molstar/lib/mol-model/loci.js';
import {
  Structure,
  StructureElement,
  Unit,
} from 'molstar/lib/mol-model/structure.js';
import type { UnitIndex } from 'molstar/lib/mol-model/structure/structure/element/element.js';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif.js';
import { describe, expect, it } from 'vitest';

import { atomicResidueLociFromClick } from '../../src/viewer/molstarInteraction';

async function structureFixture(): Promise<Structure> {
  const source = await readFile(
    new URL('../fixtures/minimal.cif', import.meta.url),
    'utf8',
  );
  const parsed = await CIF.parse(source).run();
  if (parsed.isError) throw new Error(parsed.toString());
  const block = parsed.result.blocks[0];
  if (block === undefined) throw new Error('Missing mmCIF block');
  const trajectory = await trajectoryFromMmCIF(block).run();
  return Structure.ofModel(trajectory.representative);
}

describe('atomicResidueLociFromClick', () => {
  it('expands an atomic click to the complete residue', async () => {
    const structure = await structureFixture();
    const unit = structure.units.find(Unit.isAtomic);
    if (unit === undefined) throw new Error('Missing atomic unit');
    const atom = StructureElement.Loci(structure, [
      { indices: OrderedSet.ofSingleton(0 as UnitIndex), unit },
    ]);

    expect(StructureElement.Loci.size(atom)).toBe(1);
    expect(StructureElement.Loci.size(atomicResidueLociFromClick(atom)!)).toBe(3);
  });

  it('rejects empty and non-atomic loci', async () => {
    const structure = await structureFixture();
    const unit = structure.units.find(Unit.isAtomic);
    if (unit === undefined) throw new Error('Missing atomic unit');
    const atom = StructureElement.Loci(structure, [
      { indices: OrderedSet.ofSingleton(0 as UnitIndex), unit },
    ]);
    const coarseLoci = {
      ...atom,
      elements: [
        {
          ...atom.elements[0],
          unit: { kind: Unit.Kind.Spheres } as Unit,
        },
      ],
    } as StructureElement.Loci;

    expect(atomicResidueLociFromClick(EmptyLoci)).toBeNull();
    expect(atomicResidueLociFromClick(coarseLoci)).toBeNull();
  });
});
