// SPDX-License-Identifier: MPL-2.0
import { ArticleStructureScanner } from '../article';
import { parseStructureIdentifier } from '../structures/identifiers';

const MAX_CONTEXT_MENU_SELECTION_LENGTH = 512;

/**
 * Converts a deliberate context-menu selection into a loadable identifier.
 *
 * The article scanner intentionally ignores bare four-character tokens to
 * avoid false positives in prose. A context-menu selection is a stronger user
 * signal, so exact PDB, UniProt, and AlphaFold identifiers are parsed first.
 * The scanner remains as a fallback for contextual selections such as
 * "PDB 1CRN".
 */
export function identifierFromContextMenuSelection(
  selectionText: string | undefined,
): string | null {
  const candidate = selectionText?.trim();
  if (
    candidate === undefined ||
    candidate.length === 0 ||
    candidate.length > MAX_CONTEXT_MENU_SELECTION_LENGTH
  ) {
    return null;
  }

  const exactIdentifier = parseStructureIdentifier(candidate);
  if (exactIdentifier !== null) return exactIdentifier.canonicalValue;

  return new ArticleStructureScanner().scan({ text: candidate })[0]?.id ?? null;
}
