// SPDX-License-Identifier: MPL-2.0
import { UniProtIdentifier } from './uniprot';

const ALPHAFOLD_PATTERN = /^AF-(.+)-F([1-9][0-9]*)$/i;

export class AlphaFoldIdentifier {
  readonly type = 'alphafold';
  readonly accession: UniProtIdentifier;
  readonly fragment: number;
  readonly canonicalValue: string;

  private constructor(accession: UniProtIdentifier, fragment: number) {
    this.accession = accession;
    this.fragment = fragment;
    this.canonicalValue = `AF-${accession.canonicalValue}-F${fragment}`;
  }

  static parse(input: string): AlphaFoldIdentifier | null {
    const match = ALPHAFOLD_PATTERN.exec(input.trim());
    if (match === null) return null;

    const accessionValue = match[1];
    const fragmentValue = match[2];
    if (accessionValue === undefined || fragmentValue === undefined) return null;

    const accession = UniProtIdentifier.parse(accessionValue);
    const fragment = Number(fragmentValue);

    if (
      accession === null ||
      !Number.isSafeInteger(fragment) ||
      fragment < 1
    ) {
      return null;
    }

    return new AlphaFoldIdentifier(accession, fragment);
  }

  static from(input: string): AlphaFoldIdentifier {
    const identifier = AlphaFoldIdentifier.parse(input);

    if (identifier === null) {
      throw new TypeError(`Invalid AlphaFold identifier: ${input}`);
    }

    return identifier;
  }

  static isValid(input: string): boolean {
    return AlphaFoldIdentifier.parse(input) !== null;
  }

  get displayValue(): string {
    return this.canonicalValue;
  }

  toString(): string {
    return this.canonicalValue;
  }

  toJSON(): string {
    return this.canonicalValue;
  }
}

