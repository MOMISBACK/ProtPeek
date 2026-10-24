// SPDX-License-Identifier: MPL-2.0
import type {
  Structure,
  StructureElement,
} from 'molstar/lib/mol-model/structure.js';

import type { ViewerSelection } from './StructureViewer';

function cleanCifValue(value: string): string {
  return value === '.' || value === '?' ? '' : value;
}

/** Match the same author-ID-first chain names exposed by structure metadata. */
function chainSchemas(structure: Structure): Map<string, StructureElement.SchemaItem[]> {
  const chains = new Map<string, StructureElement.SchemaItem[]>();
  const seen = new Set<string>();
  for (const model of structure.models) {
    const hierarchy = model.atomicHierarchy.chains;
    for (let index = 0; index < hierarchy._rowCount; index += 1) {
      const authId = hierarchy.auth_asym_id.value(index);
      const labelId = hierarchy.label_asym_id.value(index);
      const key = `${authId}\u0000${labelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const chainId = cleanCifValue(authId) || cleanCifValue(labelId);
      const matches = chains.get(chainId) ?? [];
      // Both fields describe one actual chain, rather than alternative names
      // that can accidentally match an unrelated chain in another namespace.
      matches.push({ auth_asym_id: authId, label_asym_id: labelId });
      chains.set(chainId, matches);
    }
  }
  return chains;
}

export function schemaForSelection(
  selection: ViewerSelection,
  structure: Structure,
): StructureElement.Schema {
  const items: StructureElement.SchemaItem[] = [];
  const chains = chainSchemas(structure);
  const addItem = (item: StructureElement.SchemaItem, chainId?: string): void => {
    if (chainId === undefined) {
      items.push(item);
      return;
    }
    for (const chain of chains.get(chainId) ?? []) {
      items.push({ ...item, ...chain });
    }
  };

  for (const chainId of selection.chains ?? []) {
    addItem({}, chainId);
  }
  for (const residue of selection.residues ?? []) {
    addItem({
      auth_seq_id: residue.number,
      pdbx_PDB_ins_code: residue.insertionCode ?? '',
    }, residue.chainId);
  }
  for (const ligand of selection.ligands ?? []) {
    addItem({ label_comp_id: ligand.compId.toUpperCase() }, ligand.chainId);
  }
  return { items };
}
