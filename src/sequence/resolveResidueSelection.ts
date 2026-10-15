// SPDX-License-Identifier: MPL-2.0
import type { ChainInfo, ResidueInfo } from '../structures/types';
import type {
  ResidueReference,
  ResidueSelectionTerm,
} from './residueSelectionParser';

export interface ResolvedResidueTarget {
  chainId: string;
  insertionCode?: string;
  number: number;
}

function chainForTerm(
  chains: readonly ChainInfo[],
  chainId: string | undefined,
): ChainInfo {
  if (chainId === undefined) {
    if (chains.length === 1 && chains[0] !== undefined) return chains[0];
    throw new Error('Specify a chain, for example A:254');
  }
  const chain = chains.find((candidate) => candidate.authId === chainId);
  if (chain === undefined) throw new Error(`Chain ${chainId} is not present`);
  return chain;
}

function observedAt(chain: ChainInfo, number: number): ResidueInfo[] {
  return chain.residues.filter(
    (residue) => residue.isObserved && residue.authNumber === number,
  );
}

function validateReference(chain: ChainInfo, reference: ResidueReference): ResidueInfo {
  const matches = observedAt(chain, reference.number).filter(
    (residue) => residue.insertionCode.toUpperCase() === (reference.insertionCode ?? ''),
  );
  const label = `${chain.authId}:${reference.number}${reference.insertionCode ?? ''}`;
  if (matches.length === 0) {
    throw new Error(`Residue ${label} is not observed`);
  }
  const match = matches[0]!;
  if (
    reference.residueCode !== undefined &&
    match.code.toUpperCase() !== reference.residueCode
  ) {
    throw new Error(`Residue ${label} is not ${reference.residueCode}`);
  }
  return match;
}

function targetForResidue(residue: ResidueInfo): ResolvedResidueTarget | null {
  if (!residue.isObserved || residue.authNumber === undefined) return null;
  return {
    chainId: residue.chainId,
    number: residue.authNumber,
    ...(residue.insertionCode === ''
      ? {}
      : { insertionCode: residue.insertionCode }),
  };
}

/** Resolves compact author-number expressions against observed structure data. */
export function resolveResidueSelection(
  terms: readonly ResidueSelectionTerm[],
  chains: readonly ChainInfo[],
  maximumResidues = 10_000,
): ResolvedResidueTarget[] {
  const targets = new Map<string, ResolvedResidueTarget>();

  for (const term of terms) {
    const chain = chainForTerm(chains, term.chainId);
    if (term.kind === 'residue') {
      const residue = validateReference(chain, term.residue);
      const target = targetForResidue(residue);
      if (target !== null) {
        targets.set(`${target.chainId}:${target.number}:${target.insertionCode ?? ''}`, target);
      }
    } else {
      if (term.start.residueCode !== undefined || term.start.insertionCode !== undefined) {
        validateReference(chain, term.start);
      }
      if (term.end.residueCode !== undefined || term.end.insertionCode !== undefined) {
        validateReference(chain, term.end);
      }
      const matches = chain.residues.filter(
        (residue) =>
          residue.isObserved &&
          residue.authNumber !== undefined &&
          residue.authNumber >= term.start.number &&
          residue.authNumber <= term.end.number &&
          (
            residue.authNumber !== term.start.number ||
            term.start.insertionCode === undefined ||
            residue.insertionCode.toUpperCase() >= term.start.insertionCode
          ) &&
          (
            residue.authNumber !== term.end.number ||
            term.end.insertionCode === undefined ||
            residue.insertionCode.toUpperCase() <= term.end.insertionCode
          ),
      );
      if (matches.length === 0) {
        throw new Error(
          `No observed residues in ${chain.authId}:${term.start.number}-${term.end.number}`,
        );
      }
      for (const residue of matches) {
        const target = targetForResidue(residue);
        if (target === null) continue;
        targets.set(
          `${target.chainId}:${target.number}:${target.insertionCode ?? ''}`,
          target,
        );
      }
    }

    if (targets.size > maximumResidues) {
      throw new Error('This residue selection is too large');
    }
  }

  return [...targets.values()];
}
