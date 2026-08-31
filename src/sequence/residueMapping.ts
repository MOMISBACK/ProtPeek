// SPDX-License-Identifier: MPL-2.0
import type { ResidueInfo } from '../structures/types';

export interface CanonicalResidueRecord {
  code: string;
  compId: string;
  labelNumber: number;
}

export interface ObservedResidueRecord {
  authNumber: number;
  chainId: string;
  code: string;
  compId: string;
  insertionCode?: string;
  labelNumber?: number;
}

function observedKey(record: ObservedResidueRecord): string {
  return `${record.labelNumber ?? ''}:${record.insertionCode ?? ''}`;
}

export function mapStructureSequence(
  chainId: string,
  canonical: readonly CanonicalResidueRecord[],
  observed: readonly ObservedResidueRecord[],
): ResidueInfo[] {
  const observedByLabel = new Map<number, ObservedResidueRecord[]>();
  const withoutLabel: ObservedResidueRecord[] = [];

  for (const residue of observed) {
    if (residue.labelNumber === undefined) {
      withoutLabel.push(residue);
      continue;
    }
    const matches = observedByLabel.get(residue.labelNumber) ?? [];
    matches.push(residue);
    observedByLabel.set(residue.labelNumber, matches);
  }

  const result: ResidueInfo[] = [];
  for (const residue of canonical) {
    const matches = observedByLabel.get(residue.labelNumber);
    if (matches === undefined || matches.length === 0) {
      result.push({
        chainId,
        code: residue.code,
        compId: residue.compId,
        insertionCode: '',
        isObserved: false,
        labelNumber: residue.labelNumber,
      });
      continue;
    }

    for (const match of [...matches].sort((a, b) =>
      observedKey(a).localeCompare(observedKey(b)),
    )) {
      result.push({
        authNumber: match.authNumber,
        chainId,
        code: match.code,
        compId: match.compId,
        insertionCode: match.insertionCode ?? '',
        isObserved: true,
        labelNumber: residue.labelNumber,
      });
    }
  }

  for (const residue of withoutLabel) {
    result.push({
      authNumber: residue.authNumber,
      chainId,
      code: residue.code,
      compId: residue.compId,
      insertionCode: residue.insertionCode ?? '',
      isObserved: true,
    });
  }

  return result;
}
