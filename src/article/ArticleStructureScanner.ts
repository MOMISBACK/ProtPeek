// SPDX-License-Identifier: MPL-2.0
import {
  detectPdbIdentifierHitsInText,
  detectPdbIdentifiersInTrustedValue,
  detectPdbIdentifiersInUrl,
} from './pdbDetection';
import {
  detectProteinIdentifierHitsInText,
  detectProteinIdentifiersInUrl,
  detectUniProtIdentifiersInTrustedValue,
} from './proteinIdentifierDetection';
import type { PdbIdentifierFormat } from '../structures/identifiers/pdb';
import type { StructureIdentifier } from '../structures/identifiers';

export interface ArticleLinkSnapshot {
  readonly href: string;
  readonly text?: string;
  readonly title?: string;
  readonly ariaLabel?: string;
}

export interface ArticleMetadataSnapshot {
  readonly content: string;
  readonly name?: string;
  readonly property?: string;
  readonly itemProp?: string;
  readonly httpEquiv?: string;
}

/** Plain data produced in the page and transferred through scripting APIs. */
export interface ArticlePageSnapshot {
  readonly text?: string;
  readonly url?: string;
  readonly links?: readonly ArticleLinkSnapshot[];
  readonly metadata?: readonly ArticleMetadataSnapshot[];
  readonly structuredData?: readonly unknown[];
}

export type ArticleStructureSource =
  | 'text'
  | 'page-url'
  | 'link'
  | 'metadata'
  | 'structured-data';

interface ArticleStructureDetectionBase {
  readonly id: string;
  readonly displayId: string;
  readonly sources: readonly ArticleStructureSource[];
}

export type ArticleStructureDetection =
  | (ArticleStructureDetectionBase & {
      readonly format: PdbIdentifierFormat;
      readonly type: 'pdb';
    })
  | (ArticleStructureDetectionBase & {
      readonly format?: never;
      readonly type: 'alphafold' | 'uniprot';
    });

interface MutableDetection {
  identifier: StructureIdentifier;
  sources: ArticleStructureSource[];
}

const PDB_FIELD_PATTERN = /(?:^|[^a-z0-9])(?:pdb(?:\s*(?:ids?|accessions?|entries?))?|rcsb|pdbe|wwpdb|protein\s*data\s*bank|structures?)(?:[^a-z0-9]|$)/i;
const UNIPROT_FIELD_PATTERN = /(?:^|[^a-z0-9])(?:uniprot(?:\s*(?:ids?|accessions?|entries?|kb))?|swiss[-\s]*prot)(?:[^a-z0-9]|$)/i;
const MAX_STRUCTURED_DEPTH = 12;
const MAX_STRUCTURED_VALUES = 5_000;

function metadataDescriptor(metadata: ArticleMetadataSnapshot): string {
  return [
    metadata.name,
    metadata.property,
    metadata.itemProp,
    metadata.httpEquiv,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');
}

function normalizedFieldName(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ');
}

function isPdbField(name: string): boolean {
  return PDB_FIELD_PATTERN.test(normalizedFieldName(name));
}

function isUniProtField(name: string): boolean {
  return UNIPROT_FIELD_PATTERN.test(normalizedFieldName(name));
}

function identifierKey(identifier: StructureIdentifier): string {
  return identifier.type === 'pdb'
    ? `pdb:${identifier.identityKey}`
    : `${identifier.type}:${identifier.canonicalValue}`;
}

function detectIdentifiersInText(text: string): StructureIdentifier[] {
  return [
    ...detectPdbIdentifierHitsInText(text),
    ...detectProteinIdentifierHitsInText(text),
  ]
    .sort((left, right) => left.index - right.index)
    .map(({ identifier }) => identifier);
}

function detectIdentifiersInUrl(
  href: string,
  baseUrl?: string,
): StructureIdentifier[] {
  return [
    ...detectPdbIdentifiersInUrl(href, baseUrl),
    ...detectProteinIdentifiersInUrl(href, baseUrl),
  ];
}

/**
 * Pure scanner: the content script only has to serialize the page once. No DOM
 * or browser global is referenced here, so the same logic runs in Node tests.
 */
export class ArticleStructureScanner {
  scan(snapshot: ArticlePageSnapshot): ArticleStructureDetection[] {
    const detections = new Map<string, MutableDetection>();

    const add = (
      identifiers: readonly StructureIdentifier[],
      source: ArticleStructureSource,
    ): void => {
      for (const identifier of identifiers) {
        const key = identifierKey(identifier);
        const existing = detections.get(key);
        if (existing === undefined) {
          detections.set(key, {
            identifier,
            sources: [source],
          });
        } else if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
      }
    };

    if (snapshot.text !== undefined) {
      add(detectIdentifiersInText(snapshot.text), 'text');
    }

    if (snapshot.url !== undefined) {
      add(detectIdentifiersInUrl(snapshot.url), 'page-url');
    }

    for (const link of snapshot.links ?? []) {
      const linkedIdentifiers = detectIdentifiersInUrl(link.href, snapshot.url);
      add(linkedIdentifiers, 'link');

      for (const label of [link.text, link.title, link.ariaLabel]) {
        if (label === undefined) continue;
        add(detectIdentifiersInText(label), 'link');

        // A bare anchor label is trusted only when its destination is an
        // official structure URL.
        if (linkedIdentifiers.some(({ type }) => type === 'pdb')) {
          add(detectPdbIdentifiersInTrustedValue(label), 'link');
        }
        if (linkedIdentifiers.some(({ type }) => type === 'uniprot')) {
          add(detectUniProtIdentifiersInTrustedValue(label), 'link');
        }
      }
    }

    for (const metadata of snapshot.metadata ?? []) {
      add(detectIdentifiersInText(metadata.content), 'metadata');
      add(detectIdentifiersInUrl(metadata.content, snapshot.url), 'metadata');

      const descriptor = metadataDescriptor(metadata);
      if (isPdbField(descriptor)) {
        add(
          detectPdbIdentifiersInTrustedValue(metadata.content),
          'metadata',
        );
      }
      if (isUniProtField(descriptor)) {
        add(
          detectUniProtIdentifiersInTrustedValue(metadata.content),
          'metadata',
        );
      }
    }

    this.#scanStructuredData(snapshot.structuredData ?? [], add, snapshot.url);

    return [...detections.values()].map(
      ({ identifier, sources }): ArticleStructureDetection => {
        const common = {
          id: identifier.canonicalValue,
          displayId: identifier.displayValue,
          sources,
        };

        return identifier.type === 'pdb'
          ? { ...common, format: identifier.format, type: 'pdb' }
          : { ...common, type: identifier.type };
      },
    );
  }

  #scanStructuredData(
    values: readonly unknown[],
    add: (
      identifiers: readonly StructureIdentifier[],
      source: ArticleStructureSource,
    ) => void,
    baseUrl?: string,
  ): void {
    const queue: Array<{
      value: unknown;
      depth: number;
      trustedPdb: boolean;
      trustedUniProt: boolean;
    }> = values
      .slice(0, MAX_STRUCTURED_VALUES)
      .map((value) => ({
        value,
        depth: 0,
        trustedPdb: false,
        trustedUniProt: false,
      }));
    const visited = new WeakSet<object>();
    let cursor = 0;

    const enqueue = (
      value: unknown,
      depth: number,
      trustedPdb: boolean,
      trustedUniProt: boolean,
    ): void => {
      if (queue.length < MAX_STRUCTURED_VALUES) {
        queue.push({ value, depth, trustedPdb, trustedUniProt });
      }
    };

    while (cursor < queue.length) {
      const current = queue[cursor];
      cursor += 1;
      if (current === undefined || current.depth > MAX_STRUCTURED_DEPTH) continue;

      if (typeof current.value === 'string') {
        // Content scripts may transfer JSON-LD either parsed or as the script's
        // raw text. Prefer the parsed tree so its source order and field context
        // are retained.
        const structuredText = current.value.trimStart();
        if (
          current.depth < MAX_STRUCTURED_DEPTH &&
          (structuredText.startsWith('{') || structuredText.startsWith('['))
        ) {
          try {
            enqueue(
              JSON.parse(current.value) as unknown,
              current.depth + 1,
              current.trustedPdb,
              current.trustedUniProt,
            );
            continue;
          } catch {
            // Invalid JSON-LD is scanned as ordinary text below.
          }
        }

        add(detectIdentifiersInText(current.value), 'structured-data');
        add(
          detectIdentifiersInUrl(current.value, baseUrl),
          'structured-data',
        );
        if (current.trustedPdb) {
          add(
            detectPdbIdentifiersInTrustedValue(current.value),
            'structured-data',
          );
        }
        if (current.trustedUniProt) {
          add(
            detectUniProtIdentifiersInTrustedValue(current.value),
            'structured-data',
          );
        }

        continue;
      }

      if (typeof current.value !== 'object' || current.value === null) continue;
      if (visited.has(current.value)) continue;
      visited.add(current.value);

      if (Array.isArray(current.value)) {
        for (const value of current.value) {
          enqueue(
            value,
            current.depth + 1,
            current.trustedPdb,
            current.trustedUniProt,
          );
        }
        continue;
      }

      for (const [name, value] of Object.entries(current.value)) {
        enqueue(
          value,
          current.depth + 1,
          current.trustedPdb || isPdbField(name),
          current.trustedUniProt || isUniProtField(name),
        );
      }
    }
  }
}
