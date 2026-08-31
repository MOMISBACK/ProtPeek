// SPDX-License-Identifier: MPL-2.0
import { Column } from 'molstar/lib/mol-data/db.js';
import { AtomicHierarchy } from 'molstar/lib/mol-model/structure/model/properties/atomic/hierarchy.js';
import type { Model, Structure } from 'molstar/lib/mol-model/structure.js';
import type {
  ChainIndex,
  ResidueIndex,
} from 'molstar/lib/mol-model/structure/model/indexing.js';

import { mapStructureSequence } from '../sequence/residueMapping';
import { aggregateLigands } from '../structures/metadata/ligands';
import type {
  ChainInfo,
  StructureMetadata,
  StructureSource,
} from '../structures/types';

function cleanCifValue(value: string): string {
  return value === '.' || value === '?' ? '' : value;
}

function entityDescription(model: Model, entityIndex: number): string {
  const description = model.entities.data.pdbx_description.value(entityIndex);
  const values = Array.isArray(description) ? description : [description];
  return values
    .map((value) => cleanCifValue(String(value ?? '')))
    .filter(Boolean)
    .join('; ');
}

function extractChains(model: Model): ChainInfo[] {
  const hierarchy = model.atomicHierarchy;
  const chains: ChainInfo[] = [];
  const seen = new Set<string>();

  for (let chainIndex = 0; chainIndex < hierarchy.chains._rowCount; chainIndex += 1) {
    const typedChainIndex = chainIndex as ChainIndex;
    const entityIndex = hierarchy.index.getEntityFromChain(typedChainIndex);
    if (entityIndex < 0 || model.entities.data.type.value(entityIndex) !== 'polymer') {
      continue;
    }

    const authId = cleanCifValue(hierarchy.chains.auth_asym_id.value(chainIndex));
    const labelId = cleanCifValue(hierarchy.chains.label_asym_id.value(chainIndex));
    const entityId = hierarchy.chains.label_entity_id.value(chainIndex);
    const key = `${authId}\u0000${labelId}\u0000${entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const canonicalSequence = model.sequence.byEntityKey[entityIndex]?.sequence;
    let canonical: Array<{
      code: string;
      compId: string;
      labelNumber: number;
    }> = canonicalSequence === undefined
      ? []
      : Array.from({ length: canonicalSequence.length }, (_, index) => ({
          code: canonicalSequence.code.value(index),
          compId: canonicalSequence.compId.value(index),
          labelNumber: canonicalSequence.seqId.value(index),
        }));

    const startResidue = AtomicHierarchy.chainStartResidueIndex(
      hierarchy,
      typedChainIndex,
    );
    const endResidue = AtomicHierarchy.chainEndResidueIndexExcl(
      hierarchy,
      typedChainIndex,
    );
    const observed = [];
    for (
      let residueIndex = Number(startResidue);
      residueIndex < Number(endResidue);
      residueIndex += 1
    ) {
      const typedResidueIndex = residueIndex as ResidueIndex;
      const atomIndex = hierarchy.residueAtomSegments.offsets[typedResidueIndex];
      if (atomIndex === undefined) continue;
      const labelNumber =
        hierarchy.residues.label_seq_id.valueKind(typedResidueIndex) ===
        Column.ValueKinds.Present
          ? hierarchy.residues.label_seq_id.value(typedResidueIndex)
          : undefined;
      const compId = hierarchy.atoms.label_comp_id.value(atomIndex);
      const canonicalIndex = labelNumber === undefined
        ? -1
        : canonicalSequence?.index(labelNumber) ?? -1;
      observed.push({
        authNumber: hierarchy.residues.auth_seq_id.value(typedResidueIndex),
        chainId: authId || labelId,
        code:
          canonicalIndex >= 0 && canonicalSequence !== undefined
            ? canonicalSequence.code.value(canonicalIndex)
            : 'X',
        compId,
        insertionCode: cleanCifValue(
          hierarchy.residues.pdbx_PDB_ins_code.value(typedResidueIndex),
        ),
        ...(labelNumber === undefined ? {} : { labelNumber }),
      });
    }

    if (canonical.length === 0) {
      const observedByLabel = new Map<
        number,
        { code: string; compId: string; labelNumber: number }
      >();
      for (const residue of observed) {
        if (residue.labelNumber === undefined) continue;
        observedByLabel.set(residue.labelNumber, {
          code: residue.code,
          compId: residue.compId,
          labelNumber: residue.labelNumber,
        });
      }
      canonical = [...observedByLabel.values()].sort(
        (left, right) => left.labelNumber - right.labelNumber,
      );
    }

    chains.push({
      authId: authId || labelId,
      entityDescription: entityDescription(model, entityIndex),
      entityId,
      labelId,
      polymerType: model.entities.subtype.value(entityIndex),
      residues: mapStructureSequence(authId || labelId, canonical, observed),
    });
  }

  return chains;
}

function extractLigands(model: Model) {
  const hierarchy = model.atomicHierarchy;
  const instances = [];

  for (let residueIndex = 0; residueIndex < hierarchy.residues._rowCount; residueIndex += 1) {
    const atomStart = hierarchy.residueAtomSegments.offsets[residueIndex];
    const atomEnd = hierarchy.residueAtomSegments.offsets[residueIndex + 1];
    if (atomStart === undefined || atomEnd === undefined) continue;
    const chainIndex = hierarchy.chainAtomSegments.index[atomStart];
    if (chainIndex === undefined) continue;
    const entityIndex = hierarchy.index.getEntityFromChain(chainIndex);
    const entityType = entityIndex < 0
      ? 'unknown'
      : model.entities.data.type.value(entityIndex);
    const compId = hierarchy.atoms.label_comp_id.value(atomStart);
    const chainId =
      cleanCifValue(hierarchy.chains.auth_asym_id.value(chainIndex)) ||
      cleanCifValue(hierarchy.chains.label_asym_id.value(chainIndex));
    const authorNumber = hierarchy.residues.auth_seq_id.value(residueIndex);
    const insertionCode = cleanCifValue(
      hierarchy.residues.pdbx_PDB_ins_code.value(residueIndex),
    );
    const component = model.properties.chemicalComponentMap.get(compId);

    instances.push({
      atomCount: atomEnd - atomStart,
      chainId,
      compId,
      instanceId: `${chainId}:${authorNumber}${insertionCode}:${compId}`,
      isPolymer: entityType === 'polymer',
      ...(component?.name === undefined ? {} : { name: component.name }),
    });
  }

  return aggregateLigands(instances);
}

export function extractMolstarMetadata(
  structure: Structure,
  source: StructureSource,
): StructureMetadata {
  const model = structure.models[0];
  return {
    atomCount: structure.elementCount,
    chains: model === undefined ? [] : extractChains(model),
    ligands: model === undefined ? [] : extractLigands(model),
    source,
  };
}
