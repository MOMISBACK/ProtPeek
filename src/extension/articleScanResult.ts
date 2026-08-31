// SPDX-License-Identifier: MPL-2.0
import type { ArticleStructureDetection } from '../article';

function isArticleStructureDetection(
  value: unknown,
): value is ArticleStructureDetection {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  const sources = candidate.sources;
  if (!Array.isArray(sources)) return false;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.displayId === 'string' &&
    (candidate.format === 'legacy' || candidate.format === 'extended') &&
    sources.every(
      (source: unknown) =>
        source === 'text' ||
        source === 'page-url' ||
        source === 'link' ||
        source === 'metadata' ||
        source === 'structured-data',
    )
  );
}

/** Validates data crossing the scripting serialization boundary. */
export function articleStructuresFromScanResult(
  value: unknown,
): ArticleStructureDetection[] {
  if (!Array.isArray(value)) return [];

  const candidates: unknown[] = value;
  return candidates.filter(isArticleStructureDetection);
}
