// SPDX-License-Identifier: MPL-2.0
import { PdbIdentifier } from '../structures/identifiers/pdb';

export interface IndexedPdbIdentifier {
  readonly identifier: PdbIdentifier;
  readonly index: number;
}

const CONTEXT_LABEL_PATTERN = /\b(?:PDB|RCSB(?:\s+PDB)?|PDBe|Protein\s+Data\s+Bank)(?:\s+(?:IDs?|identifiers?|accessions?|entry|entries|codes?))?\b/gi;
const FIRST_CONTEXT_IDENTIFIER_PATTERN = /^\s*(?:[:#=]\s*)?(?:(?:is|was)\s+)?\(?\s*([0-9][a-z0-9]{3})(?![a-z0-9_])/i;
const NEXT_CONTEXT_IDENTIFIER_PATTERN = /^\s*\)?\s*(?:[,/;]|\band\b|&)\s*\(?\s*([0-9][a-z0-9]{3})(?![a-z0-9_])/i;
const EXTENDED_IDENTIFIER_PATTERN = /(^|[^a-z0-9_])(pdb_[a-z0-9]{8})(?![a-z0-9_])/gi;
const EXACT_IDENTIFIER_LIST_PATTERN = /^\s*(?:pdb_[a-z0-9]{8}|[0-9][a-z0-9]{3})(?:\s*(?:[,/;]|\band\b|&)\s*(?:pdb_[a-z0-9]{8}|[0-9][a-z0-9]{3}))*\s*$/i;
const IDENTIFIER_IN_LIST_PATTERN = /pdb_[a-z0-9]{8}|[0-9][a-z0-9]{3}/gi;

function uniqueIdentifiers(
  identifiers: readonly PdbIdentifier[],
): PdbIdentifier[] {
  const byIdentity = new Map<string, PdbIdentifier>();

  for (const identifier of identifiers) {
    if (!byIdentity.has(identifier.identityKey)) {
      byIdentity.set(identifier.identityKey, identifier);
    }
  }

  return [...byIdentity.values()];
}

function contextualHits(text: string): IndexedPdbIdentifier[] {
  const hits: IndexedPdbIdentifier[] = [];

  for (const labelMatch of text.matchAll(CONTEXT_LABEL_PATTERN)) {
    const labelIndex = labelMatch.index;
    const label = labelMatch[0];
    if (labelIndex === undefined || label === undefined) continue;

    const valueStart = labelIndex + label.length;
    // A bounded tail avoids treating a later, unrelated token as contextual.
    const tail = text.slice(valueStart, valueStart + 128);
    const firstMatch = FIRST_CONTEXT_IDENTIFIER_PATTERN.exec(tail);
    const firstValue = firstMatch?.[1];
    if (firstMatch === null || firstValue === undefined) continue;

    const firstIdentifier = PdbIdentifier.parse(firstValue);
    if (firstIdentifier === null) continue;

    hits.push({
      identifier: firstIdentifier,
      index: valueStart + firstMatch[0].lastIndexOf(firstValue),
    });

    let consumed = firstMatch[0].length;
    while (consumed < tail.length) {
      const nextMatch = NEXT_CONTEXT_IDENTIFIER_PATTERN.exec(
        tail.slice(consumed),
      );
      const nextValue = nextMatch?.[1];
      if (nextMatch === null || nextValue === undefined) break;

      const nextIdentifier = PdbIdentifier.parse(nextValue);
      if (nextIdentifier !== null) {
        hits.push({
          identifier: nextIdentifier,
          index:
            valueStart +
            consumed +
            nextMatch[0].lastIndexOf(nextValue),
        });
      }
      consumed += nextMatch[0].length;
    }
  }

  return hits;
}

function extendedHits(text: string): IndexedPdbIdentifier[] {
  const hits: IndexedPdbIdentifier[] = [];

  for (const match of text.matchAll(EXTENDED_IDENTIFIER_PATTERN)) {
    const boundary = match[1];
    const value = match[2];
    if (value === undefined || match.index === undefined) continue;

    const identifier = PdbIdentifier.parse(value);
    if (identifier !== null) {
      hits.push({
        identifier,
        index: match.index + (boundary?.length ?? 0),
      });
    }
  }

  return hits;
}

/**
 * Detects extended IDs directly and legacy IDs only behind an explicit PDB
 * context label. It intentionally never applies the four-character pattern to
 * arbitrary article text.
 */
export function detectPdbIdentifierHitsInText(
  text: string,
): IndexedPdbIdentifier[] {
  const ordered = [...contextualHits(text), ...extendedHits(text)].sort(
    (left, right) => left.index - right.index,
  );
  const byIdentity = new Map<string, IndexedPdbIdentifier>();

  for (const hit of ordered) {
    if (!byIdentity.has(hit.identifier.identityKey)) {
      byIdentity.set(hit.identifier.identityKey, hit);
    }
  }

  return [...byIdentity.values()];
}

export function detectPdbIdentifiersInText(text: string): PdbIdentifier[] {
  return detectPdbIdentifierHitsInText(text).map(({ identifier }) => identifier);
}

/** Parses a complete ID or delimited ID list supplied by a trusted field. */
export function detectPdbIdentifiersInTrustedValue(
  value: string,
): PdbIdentifier[] {
  if (!EXACT_IDENTIFIER_LIST_PATTERN.test(value)) return [];

  const identifiers: PdbIdentifier[] = [];
  for (const match of value.matchAll(IDENTIFIER_IN_LIST_PATTERN)) {
    const identifier = PdbIdentifier.parse(match[0]);
    if (identifier !== null) identifiers.push(identifier);
  }
  return uniqueIdentifiers(identifiers);
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseUrl(href: string, baseUrl?: string): URL | null {
  try {
    return new URL(href, baseUrl ?? 'https://protpeek.invalid');
  } catch {
    return null;
  }
}

function isTrustedPdbUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  const isDomain = (domain: string): boolean =>
    host === domain || host.endsWith(`.${domain}`);

  if (
    isDomain('rcsb.org') ||
    isDomain('pdbe.org') ||
    isDomain('wwpdb.org') ||
    isDomain('pdb.org')
  ) {
    return true;
  }

  return isDomain('ebi.ac.uk') && /(?:^|\/)pdbe(?:\/|$)/i.test(url.pathname);
}

function identifierFromFileName(segment: string): PdbIdentifier | null {
  const withoutCompression = segment.replace(/\.gz$/i, '');
  const withoutFormat = withoutCompression.replace(
    /\.(?:bcif|cif|mmcif|pdb)$/i,
    '',
  );

  if (withoutFormat === withoutCompression) return null;
  return PdbIdentifier.parse(withoutFormat);
}

/** Extracts IDs only from recognizable routes on official PDB service hosts. */
export function detectPdbIdentifiersInUrl(
  href: string,
  baseUrl?: string,
): PdbIdentifier[] {
  const url = parseUrl(href, baseUrl);
  if (url === null || !isTrustedPdbUrl(url)) return [];

  const identifiers: PdbIdentifier[] = [];
  const add = (identifier: PdbIdentifier | null): void => {
    if (identifier !== null) identifiers.push(identifier);
  };

  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeUrlPart);
  const routeNames = new Set([
    'download',
    'entry',
    'entries',
    'pdb',
    'structure',
    'structures',
    'view',
  ]);

  for (const [index, segment] of segments.entries()) {
    add(identifierFromFileName(segment));

    const previousSegment = segments[index - 1]?.toLowerCase();
    if (previousSegment !== undefined && routeNames.has(previousSegment)) {
      add(PdbIdentifier.parse(segment));
    }

    for (const extended of extendedHits(segment)) add(extended.identifier);
  }

  for (const [name, value] of url.searchParams) {
    if (/^(?:entry(?:id)?|id|pdb(?:id|_id)?|structure(?:id)?)$/i.test(name)) {
      identifiers.push(...detectPdbIdentifiersInTrustedValue(value));
    }
  }

  const decodedHash = decodeUrlPart(url.hash.slice(1));
  identifiers.push(...detectPdbIdentifiersInText(decodedHash));
  return uniqueIdentifiers(identifiers);
}
