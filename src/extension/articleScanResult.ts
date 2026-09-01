// SPDX-License-Identifier: MPL-2.0
import type { ArticleStructureDetection } from '../article';
import { parseStructureIdentifier } from '../structures/identifiers';

function isArticleStructureDetection(
  value: unknown,
): value is ArticleStructureDetection {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const sources = candidate.sources;
  if (!Array.isArray(sources)) return false;

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.displayId !== 'string' ||
    !sources.every(
      (source: unknown) =>
        source === 'text' ||
        source === 'page-url' ||
        source === 'link' ||
        source === 'metadata' ||
        source === 'structured-data',
    )
  ) {
    return false;
  }

  const identifier = parseStructureIdentifier(candidate.id);
  if (
    identifier === null ||
    candidate.type !== identifier.type ||
    candidate.id !== identifier.canonicalValue ||
    candidate.displayId !== identifier.displayValue
  ) {
    return false;
  }

  return identifier.type === 'pdb'
    ? candidate.format === identifier.format
    : candidate.format === undefined;
}

/** Validates data crossing the scripting serialization boundary. */
export function articleStructuresFromScanResult(
  value: unknown,
): ArticleStructureDetection[] {
  if (!Array.isArray(value)) return [];

  const candidates: unknown[] = value;
  return candidates.filter(isArticleStructureDetection);
}
