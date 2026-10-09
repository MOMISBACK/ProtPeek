// SPDX-License-Identifier: MPL-2.0
import { PdbIdentifier } from '../structures/identifiers/pdb';

export interface IndexedPdbIdentifier {
  readonly identifier: PdbIdentifier;
  readonly index: number;
}

const IDENTIFIER_SOURCE = '(?:pdb_[a-z0-9]{8}|[0-9][a-z0-9]{3})';
const LABEL_SOURCE = '(?:wwPDB|PDB|RCSB(?:\\s+PDB)?|PDBe|Protein\\s+Data\\s+Bank)';
const QUALIFIER_SOURCE = '(?:IDs?|identifiers?|accessions?(?:\\s+(?:numbers?|codes?))?|entry|entries|codes?)';
const SEPARATOR_SOURCE = '(?:[,;]\\s*(?:(?:and|or)\\s+)?|/\\s*|&\\s*|\\b(?:and|or)\\b\\s*)';
const ANNOTATION_SOURCE = '(?:\\([^()\\r\\n]{0,80}\\)|\\[[^\\[\\]\\r\\n]{0,80}\\])';
const CONTEXT_LABEL_PATTERN = new RegExp(
  `\\b${LABEL_SOURCE}(?:\\s+(?:(?:under|with)\\s+(?:the\\s+)?)?${QUALIFIER_SOURCE})?\\b`,
  'gi',
);
const FIRST_CONTEXT_IDENTIFIER_PATTERN = new RegExp(
  `^\\s*(?:[:#=]\\s*)?(?:(?:is|was|are|were)\\s+)?(?:[([]\\s*)?(${IDENTIFIER_SOURCE})(?![a-z0-9_])`,
  'i',
);
// Continue only through an ID-list separator and, optionally, a short inline
// description such as "(apo)". Arbitrary prose must end the contextual list.
const NEXT_CONTEXT_IDENTIFIER_PATTERN = new RegExp(
  `^\\s*(?:[)\\]]\\s*)?(?:${ANNOTATION_SOURCE}\\s*)?${SEPARATOR_SOURCE}(?:[([]\\s*)?(${IDENTIFIER_SOURCE})(?![a-z0-9_])`,
  'i',
);
const SUFFIX_CONTEXT_PATTERN = new RegExp(
  `[(\\[]\\s*${LABEL_SOURCE}(?:\\s+${QUALIFIER_SOURCE})?\\s*[)\\]]`,
  'gi',
);
const LAST_SUFFIX_IDENTIFIER_PATTERN = new RegExp(
  `(^|[^a-z0-9_])(${IDENTIFIER_SOURCE})\\s*(?:${ANNOTATION_SOURCE}\\s*)?$`,
  'i',
);
const PREVIOUS_SUFFIX_IDENTIFIER_PATTERN = new RegExp(
  `(^|[^a-z0-9_])(${IDENTIFIER_SOURCE})\\s*(?:${ANNOTATION_SOURCE}\\s*)?${SEPARATOR_SOURCE}\\s*$`,
  'i',
);
const EXTENDED_IDENTIFIER_PATTERN = /(^|[^a-z0-9_])(pdb_[a-z0-9]{8})(?![a-z0-9_])/gi;
const EXACT_IDENTIFIER_LIST_PATTERN = new RegExp(
  `^\\s*${IDENTIFIER_SOURCE}(?:\\s*${SEPARATOR_SOURCE}${IDENTIFIER_SOURCE})*\\s*$`,
  'i',
);
const IDENTIFIER_IN_LIST_PATTERN = new RegExp(IDENTIFIER_SOURCE, 'gi');
const TEXT_URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TEXT_DOI_PATTERN = /(^|[^a-z0-9_])10\.2210\/(pdb(?:_[a-z0-9]{8}|[0-9][a-z0-9]{3}))\/pdb(?![a-z0-9_])/gi;
const MAX_CONTEXT_LENGTH = 1_024;

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
    const tail = text.slice(valueStart, valueStart + MAX_CONTEXT_LENGTH);
    const firstMatch = FIRST_CONTEXT_IDENTIFIER_PATTERN.exec(tail);
    const firstValue = firstMatch?.[1];
    if (firstMatch === null || firstValue === undefined) continue;

    const firstIndex = valueStart + firstMatch[0].lastIndexOf(firstValue);
    if (/[a-z0-9_]/i.test(text[firstIndex + firstValue.length] ?? '')) continue;

    const firstIdentifier = PdbIdentifier.parse(firstValue);
    if (firstIdentifier === null) continue;

    hits.push({
      identifier: firstIdentifier,
      index: firstIndex,
    });

    let consumed = firstMatch[0].length;
    while (consumed < tail.length) {
      const nextMatch = NEXT_CONTEXT_IDENTIFIER_PATTERN.exec(
        tail.slice(consumed),
      );
      const nextValue = nextMatch?.[1];
      if (nextMatch === null || nextValue === undefined) break;

      const nextIndex = valueStart + consumed + nextMatch[0].lastIndexOf(nextValue);
      if (/[a-z0-9_]/i.test(text[nextIndex + nextValue.length] ?? '')) break;

      const nextIdentifier = PdbIdentifier.parse(nextValue);
      if (nextIdentifier !== null) {
        hits.push({
          identifier: nextIdentifier,
          index: nextIndex,
        });
      }
      consumed += nextMatch[0].length;
    }
  }

  return hits;
}

function suffixContextHits(text: string): IndexedPdbIdentifier[] {
  const hits: IndexedPdbIdentifier[] = [];

  for (const match of text.matchAll(SUFFIX_CONTEXT_PATTERN)) {
    if (match.index === undefined) continue;

    const prefixStart = Math.max(0, match.index - MAX_CONTEXT_LENGTH);
    const prefix = text.slice(prefixStart, match.index);
    let previousMatch = LAST_SUFFIX_IDENTIFIER_PATTERN.exec(prefix);
    while (previousMatch !== null) {
      const value = previousMatch[2];
      if (value === undefined) break;
      const identifier = PdbIdentifier.parse(value);
      const valueIndex = previousMatch.index + (previousMatch[1]?.length ?? 0);
      if (
        valueIndex === 0 && prefixStart > 0 &&
        /[a-z0-9_]/i.test(text[prefixStart - 1] ?? '')
      ) break;
      if (identifier !== null) {
        hits.push({ identifier, index: prefixStart + valueIndex });
      }
      previousMatch = PREVIOUS_SUFFIX_IDENTIFIER_PATTERN.exec(
        prefix.slice(0, valueIndex),
      );
    }
  }

  return hits;
}

function identifierFromDoiValue(value: string): PdbIdentifier | null {
  return PdbIdentifier.parse(
    /^pdb_/i.test(value) ? value : value.slice(3),
  );
}

function referenceHits(text: string): IndexedPdbIdentifier[] {
  const hits: IndexedPdbIdentifier[] = [];
  const urlRanges: Array<{ start: number; end: number }> = [];

  for (const match of text.matchAll(TEXT_URL_PATTERN)) {
    if (match.index === undefined) continue;
    urlRanges.push({ start: match.index, end: match.index + match[0].length });
    // Sentence punctuation is not part of an article's printed URL.
    const href = match[0].replace(/[.,;:)\]}]+$/, '');
    for (const identifier of detectPdbIdentifiersInUrl(href)) {
      hits.push({ identifier, index: match.index });
    }
  }

  let urlCursor = 0;
  for (const match of text.matchAll(TEXT_DOI_PATTERN)) {
    const value = match[2];
    if (value === undefined || match.index === undefined) continue;
    const index = match.index + (match[1]?.length ?? 0);
    while ((urlRanges[urlCursor]?.end ?? Infinity) <= index) urlCursor += 1;
    const containingUrl = urlRanges[urlCursor];
    // A DOI-shaped path on an arbitrary URL is not a standalone citation.
    // Its hostname and complete route have already been checked above.
    if (
      containingUrl !== undefined &&
      containingUrl.start <= index && index < containingUrl.end
    ) continue;

    const identifier = identifierFromDoiValue(value);
    if (identifier !== null) {
      hits.push({ identifier, index });
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
 * Detects extended IDs directly and legacy IDs only with an explicit PDB
 * context label or a recognizable official URL/structure DOI. It intentionally
 * never applies the four-character pattern to arbitrary article text.
 */
export function detectPdbIdentifierHitsInText(
  text: string,
): IndexedPdbIdentifier[] {
  const ordered = [
    ...contextualHits(text),
    ...suffixContextHits(text),
    ...extendedHits(text),
    ...referenceHits(text),
  ].sort(
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

  return isDomain('ebi.ac.uk') && /(?:^|\/)pdbe(?:-srv)?(?:\/|$)/i.test(url.pathname);
}

function identifierFromFileName(segment: string): PdbIdentifier | null {
  const withoutCompression = segment.replace(/\.gz$/i, '');
  const withoutFormat = withoutCompression.replace(
    /\.(?:bcif|cif|mmcif|pdb|ent)$/i,
    '',
  );

  if (withoutFormat === withoutCompression) return null;
  return PdbIdentifier.parse(withoutFormat) ??
    PdbIdentifier.parse(withoutFormat.match(/^pdb([0-9][a-z0-9]{3})$/i)?.[1] ?? '');
}

/** Extracts IDs only from recognizable routes on official PDB service hosts. */
export function detectPdbIdentifiersInUrl(
  href: string,
  baseUrl?: string,
): PdbIdentifier[] {
  const url = parseUrl(href, baseUrl);
  if (url === null) return [];

  if (/^(?:dx\.)?doi\.org$/i.test(url.hostname)) {
    const doiValue = decodeUrlPart(url.pathname).match(
      /^\/10\.2210\/(pdb(?:_[a-z0-9]{8}|[0-9][a-z0-9]{3}))\/pdb\/?$/i,
    )?.[1];
    const identifier = doiValue === undefined
      ? null
      : identifierFromDoiValue(doiValue);
    return identifier === null ? [] : [identifier];
  }

  if (!isTrustedPdbUrl(url)) return [];

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
    '3d-view',
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
  // A URL inside a fragment must not recursively rescan other URL fragments.
  identifiers.push(
    ...contextualHits(decodedHash).map(({ identifier }) => identifier),
    ...suffixContextHits(decodedHash).map(({ identifier }) => identifier),
    ...extendedHits(decodedHash).map(({ identifier }) => identifier),
  );
  return uniqueIdentifiers(identifiers);
}
