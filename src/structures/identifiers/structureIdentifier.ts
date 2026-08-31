// SPDX-License-Identifier: MPL-2.0
import { AlphaFoldIdentifier } from './alphafold';
import { PdbIdentifier } from './pdb';
import { UniProtIdentifier } from './uniprot';

export type StructureIdentifier =
  | PdbIdentifier
  | UniProtIdentifier
  | AlphaFoldIdentifier;

interface ExplicitPrefix {
  readonly type: StructureIdentifier['type'];
  readonly value: string;
}

function extractExplicitPrefix(input: string): ExplicitPrefix | null {
  const match = /^(pdb|uniprot|alphafold)(?:\s+(?:id|accession))?\s*[:#=]\s*(.+)$/i.exec(
    input,
  );

  if (match === null) return null;

  const prefix = match[1]?.toLowerCase();
  const value = match[2];
  if (value === undefined) return null;

  switch (prefix) {
    case 'pdb':
    case 'uniprot':
    case 'alphafold':
      return { type: prefix, value };
    default:
      return null;
  }
}

/** Detects the identifier database and returns its normalized value object. */
export function parseStructureIdentifier(
  input: string,
): StructureIdentifier | null {
  const candidate = input.trim();
  if (candidate.length === 0) return null;

  const explicit = extractExplicitPrefix(candidate);
  if (explicit !== null) {
    switch (explicit.type) {
      case 'pdb':
        return PdbIdentifier.parse(explicit.value);
      case 'uniprot':
        return UniProtIdentifier.parse(explicit.value);
      case 'alphafold':
        return AlphaFoldIdentifier.parse(explicit.value);
    }
  }

  // Explicit AlphaFold IDs must be tested before their embedded UniProt ID.
  return (
    AlphaFoldIdentifier.parse(candidate) ??
    PdbIdentifier.parse(candidate) ??
    UniProtIdentifier.parse(candidate)
  );
}

