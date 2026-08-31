// SPDX-License-Identifier: MPL-2.0
import {
  detectPdbIdentifiersInText,
  detectPdbIdentifiersInTrustedValue,
  detectPdbIdentifiersInUrl,
} from './pdbDetection';
import type { PdbIdentifierFormat } from '../structures/identifiers/pdb';
import type { PdbIdentifier } from '../structures/identifiers/pdb';

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

export interface ArticleStructureDetection {
  readonly id: string;
  readonly displayId: string;
  readonly format: PdbIdentifierFormat;
  readonly sources: readonly ArticleStructureSource[];
}

interface MutableDetection {
  identifier: PdbIdentifier;
  sources: ArticleStructureSource[];
}

const RELEVANT_FIELD_PATTERN = /(?:^|[^a-z0-9])(?:pdb(?:\s*(?:ids?|accessions?|entries?))?|rcsb|pdbe|wwpdb|protein\s*data\s*bank|structures?)(?:[^a-z0-9]|$)/i;
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

function isRelevantField(name: string): boolean {
  return RELEVANT_FIELD_PATTERN.test(
    name
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replaceAll('_', ' '),
  );
}

/**
 * Pure scanner: the content script only has to serialize the page once. No DOM
 * or browser global is referenced here, so the same logic runs in Node tests.
 */
export class ArticleStructureScanner {
  scan(snapshot: ArticlePageSnapshot): ArticleStructureDetection[] {
    const detections = new Map<string, MutableDetection>();

    const add = (
      identifiers: readonly PdbIdentifier[],
      source: ArticleStructureSource,
    ): void => {
      for (const identifier of identifiers) {
        const existing = detections.get(identifier.identityKey);
        if (existing === undefined) {
          detections.set(identifier.identityKey, {
            identifier,
            sources: [source],
          });
        } else if (!existing.sources.includes(source)) {
          existing.sources.push(source);
        }
      }
    };

    if (snapshot.text !== undefined) {
      add(detectPdbIdentifiersInText(snapshot.text), 'text');
    }

    if (snapshot.url !== undefined) {
      add(detectPdbIdentifiersInUrl(snapshot.url), 'page-url');
    }

    for (const link of snapshot.links ?? []) {
      const linkedIdentifiers = detectPdbIdentifiersInUrl(
        link.href,
        snapshot.url,
      );
      add(linkedIdentifiers, 'link');

      for (const label of [link.text, link.title, link.ariaLabel]) {
        if (label === undefined) continue;
        add(detectPdbIdentifiersInText(label), 'link');

        // A bare anchor label is trusted only when its destination is an
        // official structure URL.
        if (linkedIdentifiers.length > 0) {
          add(detectPdbIdentifiersInTrustedValue(label), 'link');
        }
      }
    }

    for (const metadata of snapshot.metadata ?? []) {
      add(detectPdbIdentifiersInText(metadata.content), 'metadata');
      add(
        detectPdbIdentifiersInUrl(metadata.content, snapshot.url),
        'metadata',
      );

      if (isRelevantField(metadataDescriptor(metadata))) {
        add(
          detectPdbIdentifiersInTrustedValue(metadata.content),
          'metadata',
        );
      }
    }

    this.#scanStructuredData(snapshot.structuredData ?? [], add, snapshot.url);

    return [...detections.values()].map(({ identifier, sources }) => ({
      id: identifier.canonicalValue,
      displayId: identifier.displayValue,
      format: identifier.format,
      sources,
    }));
  }

  #scanStructuredData(
    values: readonly unknown[],
    add: (
      identifiers: readonly PdbIdentifier[],
      source: ArticleStructureSource,
    ) => void,
    baseUrl?: string,
  ): void {
    const queue: Array<{
      value: unknown;
      depth: number;
      trusted: boolean;
    }> = values
      .slice(0, MAX_STRUCTURED_VALUES)
      .map((value) => ({ value, depth: 0, trusted: false }));
    const visited = new WeakSet<object>();
    let cursor = 0;

    const enqueue = (
      value: unknown,
      depth: number,
      trusted: boolean,
    ): void => {
      if (queue.length < MAX_STRUCTURED_VALUES) {
        queue.push({ value, depth, trusted });
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
              current.trusted,
            );
            continue;
          } catch {
            // Invalid JSON-LD is scanned as ordinary text below.
          }
        }

        add(detectPdbIdentifiersInText(current.value), 'structured-data');
        add(
          detectPdbIdentifiersInUrl(current.value, baseUrl),
          'structured-data',
        );
        if (current.trusted) {
          add(
            detectPdbIdentifiersInTrustedValue(current.value),
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
          enqueue(value, current.depth + 1, current.trusted);
        }
        continue;
      }

      for (const [name, value] of Object.entries(current.value)) {
        enqueue(
          value,
          current.depth + 1,
          current.trusted || isRelevantField(name),
        );
      }
    }
  }
}
