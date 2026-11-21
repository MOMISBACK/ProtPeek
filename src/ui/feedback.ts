// SPDX-License-Identifier: MPL-2.0
export const CHROME_REVIEWS_URL = 'https://chromewebstore.google.com/detail/protpeek-%E2%80%93-protein-struct/mjiidagjpbabdncmgpabcijgndnbemck/reviews?hl=fr';
export const FIREFOX_REVIEWS_URL = 'https://addons.mozilla.org/firefox/addon/protpeek/reviews/';
export const CHROME_EXTENSION_URL = 'https://chromewebstore.google.com/detail/protpeek-%E2%80%93-protein-struct/mjiidagjpbabdncmgpabcijgndnbemck';
export const FIREFOX_EXTENSION_URL = 'https://addons.mozilla.org/firefox/addon/protpeek/';
export const ZOTERO_SHARE_PAGE_URL = 'https://github.com/MOMISBACK/ProtPeek';

/** Use the configured review destination; no user-agent or account detection. */
export function extensionPageForReviews(reviewUrl: string): string {
  try {
    if (new URL(reviewUrl).hostname === 'addons.mozilla.org') return FIREFOX_EXTENSION_URL;
  } catch {
    // A custom host may not supply a valid review URL; retain a safe fixed target.
  }
  return CHROME_EXTENSION_URL;
}
// Kept for the existing Zotero bridge API.
export const FEEDBACK_FORM_URL = CHROME_REVIEWS_URL;
