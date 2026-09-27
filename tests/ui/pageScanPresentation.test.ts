// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { pageScanPresentation } from '../../src/ui/pageScanPresentation';

describe('Page scan presentation', () => {
  it('shows the automatic scanning state before a result arrives', () => {
    expect(pageScanPresentation(null)).toEqual({
      heading: '',
      showResults: false,
      status: 'Scanning this page…',
    });
  });

  it('keeps the hero and reports an empty scan', () => {
    expect(pageScanPresentation(0)).toEqual({
      heading: '',
      showResults: false,
      status: 'No structures found on this page.',
    });
  });

  it('replaces the hero with a correctly pluralized result list', () => {
    expect(pageScanPresentation(1)).toMatchObject({
      heading: '1 STRUCTURE FOUND',
      showResults: true,
    });
    expect(pageScanPresentation(3)).toMatchObject({
      heading: '3 STRUCTURES FOUND',
      showResults: true,
    });
  });

  it('surfaces the real scanner error without demo content', () => {
    expect(pageScanPresentation(0, 'This page cannot be scanned')).toEqual({
      heading: '',
      showResults: false,
      status: 'This page cannot be scanned',
    });
  });
});
