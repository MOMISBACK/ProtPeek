// SPDX-License-Identifier: MPL-2.0
const LEGACY_PDB_PATTERN = /^[0-9][a-z0-9]{3}$/i;
const EXTENDED_PDB_PATTERN = /^pdb_[a-z0-9]{8}$/i;

export type PdbIdentifierFormat = 'legacy' | 'extended';

/**
 * A syntactically valid wwPDB identifier.
 *
 * Syntax validation is deliberately kept separate from checking whether an
 * entry exists in the archive. Network-backed loaders can perform the latter
 * without making identifiers or article scanning asynchronous.
 */
export class PdbIdentifier {
  readonly type = 'pdb';
  readonly canonicalValue: string;
  readonly format: PdbIdentifierFormat;

  private constructor(
    canonicalValue: string,
    format: PdbIdentifierFormat,
  ) {
    this.canonicalValue = canonicalValue;
    this.format = format;
  }

  static parse(input: string): PdbIdentifier | null {
    const candidate = input.trim();

    if (LEGACY_PDB_PATTERN.test(candidate)) {
      return new PdbIdentifier(candidate.toLowerCase(), 'legacy');
    }

    if (EXTENDED_PDB_PATTERN.test(candidate)) {
      return new PdbIdentifier(candidate.toLowerCase(), 'extended');
    }

    return null;
  }

  static from(input: string): PdbIdentifier {
    const identifier = PdbIdentifier.parse(input);

    if (identifier === null) {
      throw new TypeError(`Invalid PDB identifier: ${input}`);
    }

    return identifier;
  }

  static isValid(input: string): boolean {
    return PdbIdentifier.parse(input) !== null;
  }

  /** Uppercase is conventional for displaying legacy IDs. */
  get displayValue(): string {
    return this.format === 'legacy'
      ? this.canonicalValue.toUpperCase()
      : this.canonicalValue;
  }

  /**
   * Existing four-character entries also have a pdb_0000-prefixed form.
   * Returning a shared key lets scanners deduplicate both spellings.
   */
  get identityKey(): string {
    if (this.format === 'extended') {
      const legacyCandidate = this.canonicalValue.match(
        /^pdb_0000([0-9][a-z0-9]{3})$/,
      )?.[1];

      if (legacyCandidate !== undefined) return legacyCandidate;
    }

    return this.canonicalValue;
  }

  get legacyEquivalent(): PdbIdentifier | null {
    if (this.format === 'legacy') return this;

    const legacyValue = this.identityKey;
    return legacyValue === this.canonicalValue
      ? null
      : PdbIdentifier.parse(legacyValue);
  }

  isEquivalentTo(other: PdbIdentifier): boolean {
    return this.identityKey === other.identityKey;
  }

  toString(): string {
    return this.canonicalValue;
  }

  toJSON(): string {
    return this.canonicalValue;
  }
}

