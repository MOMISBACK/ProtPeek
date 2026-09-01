// SPDX-License-Identifier: MPL-2.0
import { browser } from 'wxt/browser';

import { ArticleStructureScanner, type ArticlePageSnapshot } from '../article';
import {
  ArticleChangeRefreshDebouncer,
  articlePageChangedMessage,
} from '../browser/sidePanelSession';

const MAX_TEXT_LENGTH = 2_000_000;
const MAX_ELEMENTS = 5_000;

interface ArticleScanMonitorState {
  readonly debouncer: ArticleChangeRefreshDebouncer;
  readonly observer: MutationObserver;
}

interface ArticleScanGlobal {
  __PROTPEEK_ARTICLE_SCAN_MONITOR__?: ArticleScanMonitorState;
}

function text(value: string | null | undefined, maximum = 1_000): string {
  return (value ?? '').slice(0, maximum);
}

function captureArticleSnapshot(): ArticlePageSnapshot {
  const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')]
    .slice(0, MAX_ELEMENTS)
    .map((link) => ({
      ariaLabel: text(link.getAttribute('aria-label')),
      href: link.href,
      text: text(link.textContent),
      title: text(link.title),
    }));

  const metadata = [...document.querySelectorAll<HTMLMetaElement>('meta[content]')]
    .slice(0, MAX_ELEMENTS)
    .map((meta) => ({
      content: text(meta.content, 10_000),
      httpEquiv: text(meta.httpEquiv),
      itemProp: text(meta.getAttribute('itemprop')),
      name: text(meta.name),
      property: text(meta.getAttribute('property')),
    }));

  const structuredData = [
    ...document.querySelectorAll<HTMLScriptElement>(
      'script[type="application/ld+json"]',
    ),
  ]
    .slice(0, 100)
    .map((script) => text(script.textContent, 100_000));

  return {
    links,
    metadata,
    structuredData,
    text: text(document.body?.innerText, MAX_TEXT_LENGTH),
    url: location.href,
  };
}

/**
 * Keep the one-shot scan cheap while still noticing article content rendered
 * after load. Re-injections reuse the same observer, and only a live panel
 * reacts to the resulting extension message.
 */
function installArticleChangeMonitor(): void {
  const pageGlobal = globalThis as typeof globalThis & ArticleScanGlobal;
  if (pageGlobal.__PROTPEEK_ARTICLE_SCAN_MONITOR__ !== undefined) return;

  const root = document.documentElement;
  if (root === null || typeof MutationObserver === 'undefined') return;

  const debouncer = new ArticleChangeRefreshDebouncer(() => {
    void browser.runtime.sendMessage(articlePageChangedMessage()).catch(() => {
      // The panel may have been closed since this page was scanned.
    });
  });
  const observer = new MutationObserver(() => debouncer.schedule());
  const state = { debouncer, observer };
  pageGlobal.__PROTPEEK_ARTICLE_SCAN_MONITOR__ = state;

  observer.observe(root, {
    attributeFilter: [
      'aria-label',
      'content',
      'href',
      'http-equiv',
      'itemprop',
      'name',
      'property',
      'title',
      'type',
    ],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });

  window.addEventListener(
    'pagehide',
    () => {
      debouncer.cancel();
      observer.disconnect();
      delete pageGlobal.__PROTPEEK_ARTICLE_SCAN_MONITOR__;
    },
    { once: true },
  );
}

export default defineUnlistedScript({
  globalName: true,
  main() {
    installArticleChangeMonitor();
    return new ArticleStructureScanner().scan(captureArticleSnapshot());
  },
});
