// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';
import { CHROME_EXTENSION_URL, CHROME_REVIEWS_URL, FIREFOX_EXTENSION_URL, FIREFOX_REVIEWS_URL, extensionPageForReviews } from '../../src/ui/feedback';

describe('Extension sharing destinations', () => {
  it('shares the Chrome listing without sending visitors directly to reviews or selecting an account', () => {
    const page = new URL(extensionPageForReviews(CHROME_REVIEWS_URL));
    expect(page.href).toBe(CHROME_EXTENSION_URL);
    expect(page.pathname.endsWith('/reviews')).toBe(false);
    expect(page.search).toBe('');
  });

  it.each([
    FIREFOX_REVIEWS_URL,
    'https://addons.mozilla.org/en-US/firefox/addon/protpeek/reviews/?utm_source=extension',
    'https://addons.mozilla.org/fr/firefox/addon/protpeek/reviews/',
  ])('shares the Firefox listing independently of review-URL localisation: %s', reviewUrl => {
    expect(extensionPageForReviews(reviewUrl)).toBe(FIREFOX_EXTENSION_URL);
  });

  it('uses a safe fixed fallback for an invalid custom review URL', () => {
    expect(extensionPageForReviews('invalid')).toBe(CHROME_EXTENSION_URL);
  });
});
