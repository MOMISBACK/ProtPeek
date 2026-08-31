// SPDX-License-Identifier: MPL-2.0
import { Loci } from 'molstar/lib/mol-model/loci.js';
import {
  Bond,
  Structure,
  StructureElement,
  Unit,
} from 'molstar/lib/mol-model/structure.js';

function containsOnlyAtomicUnits(loci: Loci): boolean {
  if (StructureElement.Loci.is(loci)) {
    return (
      loci.elements.length > 0 &&
      loci.elements.every(({ unit }) => Unit.isAtomic(unit))
    );
  }
  if (Bond.isLoci(loci)) {
    return (
      loci.bonds.length > 0 &&
      loci.bonds.every(
        ({ aUnit, bUnit }) => Unit.isAtomic(aUnit) && Unit.isAtomic(bUnit),
      )
    );
  }
  if (Structure.isLoci(loci)) {
    return (
      loci.structure.units.length > 0 &&
      loci.structure.units.every((unit) => Unit.isAtomic(unit))
    );
  }
  return false;
}

export function atomicResidueLociFromClick(
  loci: Loci,
): StructureElement.Loci | null {
  if (!containsOnlyAtomicUnits(loci)) return null;
  const normalized = Loci.normalize(loci, 'residue', true);
  if (
    !StructureElement.Loci.is(normalized) ||
    StructureElement.Loci.isEmpty(normalized)
  ) {
    return null;
  }
  return normalized;
}
