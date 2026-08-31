// SPDX-License-Identifier: MPL-2.0
const UNIPROT_ACCESSION_PATTERN = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/i;

export class UniProtIdentifier {
  readonly type = 'uniprot';
  readonly canonicalValue: string;

  private constructor(canonicalValue: string) {
    this.canonicalValue = canonicalValue;
  }

  static parse(input: string): UniProtIdentifier | null {
    const candidate = input.trim();

    return UNIPROT_ACCESSION_PATTERN.test(candidate)
      ? new UniProtIdentifier(candidate.toUpperCase())
      : null;
  }

  static from(input: string): UniProtIdentifier {
    const identifier = UniProtIdentifier.parse(input);

    if (identifier === null) {
      throw new TypeError(`Invalid UniProt accession: ${input}`);
    }

    return identifier;
  }

  static isValid(input: string): boolean {
    return UniProtIdentifier.parse(input) !== null;
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

