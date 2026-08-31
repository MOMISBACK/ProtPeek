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

function validateReference(chain: ChainInfo, reference: ResidueReference): void {
  const matches = observedAt(chain, reference.number);
  if (matches.length === 0) {
    throw new Error(`Residue ${chain.authId}:${reference.number} is not observed`);
  }
  if (
    reference.residueCode !== undefined &&
    !matches.some(
      (residue) => residue.code.toUpperCase() === reference.residueCode,
    )
  ) {
    throw new Error(
      `Residue ${chain.authId}:${reference.number} is not ${reference.residueCode}`,
    );
  }
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
      validateReference(chain, term.residue);
      const target = { chainId: chain.authId, number: term.residue.number };
      targets.set(`${target.chainId}:${target.number}`, target);
    } else {
      if (term.start.residueCode !== undefined) {
        validateReference(chain, term.start);
      }
      if (term.end.residueCode !== undefined) {
        validateReference(chain, term.end);
      }
      const matches = chain.residues.filter(
        (residue) =>
          residue.isObserved &&
          residue.authNumber !== undefined &&
          residue.authNumber >= term.start.number &&
          residue.authNumber <= term.end.number,
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
