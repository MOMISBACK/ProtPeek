// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { shouldHideEmptyState } from '../../src/ui/emptyStateVisibility';

describe('empty structure state visibility', () => {
  it('stays hidden throughout initial and replacement loads', () => {
    expect(shouldHideEmptyState(false, true)).toBe(true);
    expect(shouldHideEmptyState(true, true)).toBe(true);
  });

  it('preserves a loaded structure during acquisition of its replacement', () => {
    expect(shouldHideEmptyState(true, false)).toBe(true);
  });

  it('returns only after a failed or cancelled load leaves no structure', () => {
    expect(shouldHideEmptyState(false, false)).toBe(false);
  });
});
