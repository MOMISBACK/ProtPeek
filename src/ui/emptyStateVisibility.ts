// SPDX-License-Identifier: MPL-2.0
export function shouldHideEmptyState(
  hasStructure: boolean,
  loading: boolean,
): boolean {
  return hasStructure || loading;
}
