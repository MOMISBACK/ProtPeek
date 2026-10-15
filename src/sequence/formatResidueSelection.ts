// SPDX-License-Identifier: MPL-2.0
import type { ChainInfo } from '../structures/types';
import type { ResolvedResidueTarget } from './resolveResidueSelection';

export function residueTargetKey(residue: ResolvedResidueTarget): string {
  return `${residue.chainId}:${residue.number}:${residue.insertionCode ?? ''}`;
}

/**
 * Serialize observed author residue IDs. Only collapse consecutive plain
 * residue numbers when doing so cannot inadvertently include insertion-coded
 * residues that were not selected.
 */
export function formatResidueSelection(
  residues: readonly ResolvedResidueTarget[],
  chains: readonly ChainInfo[],
): string {
  const unique = new Map<string, ResolvedResidueTarget>();
  for (const residue of residues) {
    unique.set(residueTargetKey(residue), residue);
  }
  const groups = new Map<string, ResolvedResidueTarget[]>();
  for (const residue of unique.values()) {
    const group = groups.get(residue.chainId) ?? [];
    group.push(residue);
    groups.set(residue.chainId, group);
  }

  return [...groups].map(([chainId, group]) => {
    group.sort((a, b) =>
      a.number - b.number ||
      (a.insertionCode ?? '').localeCompare(b.insertionCode ?? ''),
    );
    const chain = chains.find((candidate) => candidate.authId === chainId);
    const terms: string[] = [];

    for (let index = 0; index < group.length;) {
      const first = group[index]!;
      let end = index;
      if (!first.insertionCode && chain !== undefined) {
        while (end + 1 < group.length) {
          const next = group[end + 1]!;
          if (
            next.insertionCode ||
            next.number !== group[end]!.number + 1 ||
            chain.residues.some((residue) =>
              residue.isObserved &&
              residue.insertionCode !== '' &&
              residue.authNumber !== undefined &&
              residue.authNumber >= first.number &&
              residue.authNumber <= next.number
            )
          ) break;
          end += 1;
        }
      }
      const last = group[end]!;
      terms.push(end > index
        ? `${first.number}-${last.number}`
        : `${first.number}${first.insertionCode ?? ''}`);
      index = end + 1;
    }

    return `${chainId}:${terms.join(',')}`;
  }).join(',');
}
