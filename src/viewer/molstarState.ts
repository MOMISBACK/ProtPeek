// SPDX-License-Identifier: MPL-2.0
export const MolstarComponentTag = {
  isolate: 'protpeek-isolate',
  polymer: 'structure-component-static-polymer',
  selection: 'protpeek-selection',
  water: 'structure-component-static-water',
} as const;

export type MolstarComponentTagName =
  (typeof MolstarComponentTag)[keyof typeof MolstarComponentTag];

export function hasMolstarTag(
  tags: readonly string[] | ReadonlySet<string> | undefined,
  tag: MolstarComponentTagName,
): boolean {
  if (tags === undefined) return false;
  return 'has' in tags ? tags.has(tag) : tags.includes(tag);
}
