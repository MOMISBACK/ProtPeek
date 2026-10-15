// SPDX-License-Identifier: MPL-2.0
export interface ResidueReference {
  readonly number: number;
  readonly residueCode?: string;
  readonly insertionCode?: string;
}

interface ResidueSelectionTermBase {
  readonly chainId?: string;
}

export interface SingleResidueSelection extends ResidueSelectionTermBase {
  readonly kind: 'residue';
  readonly residue: ResidueReference;
}

export interface ResidueRangeSelection extends ResidueSelectionTermBase {
  readonly kind: 'range';
  readonly start: ResidueReference;
  readonly end: ResidueReference;
}

export type ResidueSelectionTerm =
  | SingleResidueSelection
  | ResidueRangeSelection;

export type ResidueSelectionParseErrorCode =
  | 'empty-selection'
  | 'empty-term'
  | 'invalid-chain'
  | 'invalid-residue'
  | 'descending-range';

export class ResidueSelectionParseError extends Error {
  constructor(
    readonly code: ResidueSelectionParseErrorCode,
    readonly termIndex: number,
    message: string,
  ) {
    super(message);
    this.name = 'ResidueSelectionParseError';
  }
}

const CHAIN_PATTERN = /^[a-z0-9][a-z0-9_.-]*$/i;
// A leading letter is an amino-acid code; a trailing letter is the PDB insertion code.
const RESIDUE_EXPRESSION_PATTERN = /^([a-z]?)\s*(-?[0-9]+)([a-z]?)(?:\s*-\s*([a-z]?)\s*(-?[0-9]+)([a-z]?))?$/i;

function parseSafeInteger(
  value: string,
  termIndex: number,
): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new ResidueSelectionParseError(
      'invalid-residue',
      termIndex,
      `Residue number is outside the supported integer range: ${value}`,
    );
  }
  return number;
}

function reference(
  number: number,
  residueCode: string | undefined,
  insertionCode: string | undefined,
): ResidueReference {
  return {
    number,
    ...(residueCode ? { residueCode: residueCode.toUpperCase() } : {}),
    ...(insertionCode ? { insertionCode: insertionCode.toUpperCase() } : {}),
  };
}

function withOptionalChain<T extends { readonly kind: string }>(
  value: T,
  chainId: string | undefined,
): T & { readonly chainId?: string } {
  return chainId === undefined ? value : { ...value, chainId };
}

function parseExpression(
  expression: string,
  chainId: string | undefined,
  termIndex: number,
): ResidueSelectionTerm {
  const match = RESIDUE_EXPRESSION_PATTERN.exec(expression);
  if (match === null) {
    throw new ResidueSelectionParseError(
      'invalid-residue',
      termIndex,
      `Invalid residue expression: ${expression}`,
    );
  }

  const startCode = match[1];
  const startValue = match[2];
  const startInsertion = match[3];
  const endCode = match[4];
  const endValue = match[5];
  const endInsertion = match[6];
  if (startValue === undefined) {
    throw new ResidueSelectionParseError(
      'invalid-residue',
      termIndex,
      `Invalid residue expression: ${expression}`,
    );
  }

  const startNumber = parseSafeInteger(startValue, termIndex);
  const start = reference(startNumber, startCode, startInsertion);
  if (endValue === undefined) {
    return withOptionalChain({ kind: 'residue', residue: start }, chainId);
  }

  const endNumber = parseSafeInteger(endValue, termIndex);
  if (endNumber < startNumber ||
    (endNumber === startNumber &&
      (endInsertion ?? '') < (startInsertion ?? ''))) {
    throw new ResidueSelectionParseError(
      'descending-range',
      termIndex,
      `Residue range must be ascending: ${expression}`,
    );
  }

  return withOptionalChain(
    {
      kind: 'range',
      start,
      end: reference(endNumber, endCode, endInsertion),
    },
    chainId,
  );
}

/**
 * Parses compact author-residue selections without expanding ranges. A chain
 * prefix remains active for subsequent comma-separated terms, so
 * `A:254,278,281` applies chain A to all three residues.
 */
export function parseResidueSelection(input: string): ResidueSelectionTerm[] {
  if (input.trim().length === 0) {
    throw new ResidueSelectionParseError(
      'empty-selection',
      0,
      'Residue selection is empty',
    );
  }

  const rawTerms = input.split(',');
  const terms: ResidueSelectionTerm[] = [];
  let inheritedChain: string | undefined;

  for (const [termIndex, rawTerm] of rawTerms.entries()) {
    const term = rawTerm.trim();
    if (term.length === 0) {
      throw new ResidueSelectionParseError(
        'empty-term',
        termIndex,
        'Residue selection contains an empty term',
      );
    }

    const firstColon = term.indexOf(':');
    let expression = term;
    if (firstColon !== -1) {
      if (firstColon !== term.lastIndexOf(':')) {
        throw new ResidueSelectionParseError(
          'invalid-chain',
          termIndex,
          `Invalid chain prefix: ${term}`,
        );
      }

      const chain = term.slice(0, firstColon).trim();
      expression = term.slice(firstColon + 1).trim();
      if (!CHAIN_PATTERN.test(chain)) {
        throw new ResidueSelectionParseError(
          'invalid-chain',
          termIndex,
          `Invalid chain identifier: ${chain}`,
        );
      }
      inheritedChain = chain.toUpperCase();
    }

    terms.push(parseExpression(expression, inheritedChain, termIndex));
  }

  return terms;
}

