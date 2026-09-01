// SPDX-License-Identifier: MPL-2.0
import { AlphaFoldIdentifier } from '../structures/identifiers/alphafold';
import { UniProtIdentifier } from '../structures/identifiers/uniprot';

export type ArticleProteinIdentifier =
  | AlphaFoldIdentifier
  | UniProtIdentifier;

export interface IndexedProteinIdentifier {
  readonly identifier: ArticleProteinIdentifier;
  readonly index: number;
}

const UNIPROT_CONTEXT_LABEL_PATTERN = /\b(?:UniProt(?:KB)?(?:\s*\/\s*Swiss-Prot)?|Swiss[-\s]?Prot)(?:\s+(?:IDs?|identifiers?|accessions?(?:\s+numbers?)?|entries?))?\b/gi;
const FIRST_UNIPROT_IDENTIFIER_PATTERN = /^\s*(?:[:#=]\s*)?(?:(?:is|was)\s+)?\(?\s*([a-z0-9]{6}(?:[a-z0-9]{4})?)(?![a-z0-9_])/i;
const NEXT_UNIPROT_IDENTIFIER_PATTERN = /^\s*\)?\s*(?:[,/;]|\band\b|&)\s*\(?\s*([a-z0-9]{6}(?:[a-z0-9]{4})?)(?![a-z0-9_])/i;
const ALPHAFOLD_IDENTIFIER_PATTERN = /(^|[^a-z0-9_])(AF-[a-z0-9]{6,10}-F[1-9][0-9]*)(?![a-z0-9_])/gi;
const TRUSTED_VALUE_SEPARATOR = /\s*(?:[,/;]|&|\band\b)\s*/i;

function identifierKey(identifier: ArticleProteinIdentifier): string {
  return `${identifier.type}:${identifier.canonicalValue}`;
}

function uniqueIdentifiers<Identifier extends ArticleProteinIdentifier>(
  identifiers: readonly Identifier[],
): Identifier[] {
  const byIdentity = new Map<string, Identifier>();

  for (const identifier of identifiers) {
    const key = identifierKey(identifier);
    if (!byIdentity.has(key)) byIdentity.set(key, identifier);
  }

  return [...byIdentity.values()];
}

function contextualUniProtHits(text: string): IndexedProteinIdentifier[] {
  const hits: IndexedProteinIdentifier[] = [];

  for (const labelMatch of text.matchAll(UNIPROT_CONTEXT_LABEL_PATTERN)) {
    const labelIndex = labelMatch.index;
    const label = labelMatch[0];
    if (labelIndex === undefined || label === undefined) continue;

    const valueStart = labelIndex + label.length;
    // Do not let a database mention lend context to a distant accession-like
    // token later in the prose.
    const tail = text.slice(valueStart, valueStart + 160);
    const firstMatch = FIRST_UNIPROT_IDENTIFIER_PATTERN.exec(tail);
    const firstValue = firstMatch?.[1];
    if (firstMatch === null || firstValue === undefined) continue;

    const firstIdentifier = UniProtIdentifier.parse(firstValue);
    if (firstIdentifier === null) continue;

    hits.push({
      identifier: firstIdentifier,
      index: valueStart + firstMatch[0].lastIndexOf(firstValue),
    });

    let consumed = firstMatch[0].length;
    while (consumed < tail.length) {
      const nextMatch = NEXT_UNIPROT_IDENTIFIER_PATTERN.exec(
        tail.slice(consumed),
      );
      const nextValue = nextMatch?.[1];
      if (nextMatch === null || nextValue === undefined) break;

      const nextIdentifier = UniProtIdentifier.parse(nextValue);
      if (nextIdentifier !== null) {
        hits.push({
          identifier: nextIdentifier,
          index:
            valueStart + consumed + nextMatch[0].lastIndexOf(nextValue),
        });
      }
      consumed += nextMatch[0].length;
    }
  }

  return hits;
}

function alphaFoldHits(text: string): IndexedProteinIdentifier[] {
  const hits: IndexedProteinIdentifier[] = [];

  for (const match of text.matchAll(ALPHAFOLD_IDENTIFIER_PATTERN)) {
    const boundary = match[1];
    const value = match[2];
    if (value === undefined || match.index === undefined) continue;

    const identifier = AlphaFoldIdentifier.parse(value);
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
 * Finds full AlphaFold IDs directly, but accepts bare UniProt accessions only
 * when an adjacent label establishes their meaning.
 */
export function detectProteinIdentifierHitsInText(
  text: string,
): IndexedProteinIdentifier[] {
  const ordered = [...contextualUniProtHits(text), ...alphaFoldHits(text)].sort(
    (left, right) => left.index - right.index,
  );
  const byIdentity = new Map<string, IndexedProteinIdentifier>();

  for (const hit of ordered) {
    const key = identifierKey(hit.identifier);
    if (!byIdentity.has(key)) byIdentity.set(key, hit);
  }

  return [...byIdentity.values()];
}

export function detectProteinIdentifiersInText(
  text: string,
): ArticleProteinIdentifier[] {
  return detectProteinIdentifierHitsInText(text).map(
    ({ identifier }) => identifier,
  );
}

/** Parses only a complete accession or delimited accession list. */
export function detectUniProtIdentifiersInTrustedValue(
  value: string,
): UniProtIdentifier[] {
  const candidate = value.trim();
  if (candidate.length === 0) return [];

  const identifiers = candidate
    .split(TRUSTED_VALUE_SEPARATOR)
    .map((part) => UniProtIdentifier.parse(part));
  if (identifiers.some((identifier) => identifier === null)) return [];

  return uniqueIdentifiers(
    identifiers.filter(
      (identifier): identifier is UniProtIdentifier => identifier !== null,
    ),
  );
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

function isDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function accessionFromUrlSegment(segment: string): UniProtIdentifier | null {
  return UniProtIdentifier.parse(
    segment.replace(/\.(?:fasta|json|rdf|txt|xml)$/i, ''),
  );
}

/** Extracts identifiers only from recognizable routes on official services. */
export function detectProteinIdentifiersInUrl(
  href: string,
  baseUrl?: string,
): ArticleProteinIdentifier[] {
  const url = parseUrl(href, baseUrl);
  if (url === null || url.protocol !== 'https:') return [];

  const host = url.hostname.toLowerCase();
  const isUniProt = isDomain(host, 'uniprot.org');
  const isAlphaFold = host === 'alphafold.ebi.ac.uk';
  if (!isUniProt && !isAlphaFold) return [];

  const identifiers: ArticleProteinIdentifier[] = [];
  const segments = url.pathname
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeUrlPart);

  if (isAlphaFold) {
    for (const segment of segments) {
      identifiers.push(
        ...alphaFoldHits(segment).map(({ identifier }) => identifier),
      );
    }
  }

  const routeNames = isUniProt
    ? new Set(['uniprot', 'uniprotkb'])
    : new Set(['entry', 'prediction', 'predictions']);
  for (const [index, segment] of segments.entries()) {
    const previous = segments[index - 1]?.toLowerCase();
    if (previous === undefined || !routeNames.has(previous)) continue;

    const identifier = accessionFromUrlSegment(segment);
    if (identifier !== null) identifiers.push(identifier);
  }

  for (const [name, value] of url.searchParams) {
    if (
      !/^(?:accession|entry(?:id)?|id|model(?:entity)?id|uniprot(?:accession|id|kb)?)$/i.test(
        name,
      )
    ) {
      continue;
    }

    if (isAlphaFold) {
      identifiers.push(
        ...alphaFoldHits(value).map(({ identifier }) => identifier),
      );
    }
    identifiers.push(...detectUniProtIdentifiersInTrustedValue(value));
  }

  return uniqueIdentifiers(identifiers);
}
