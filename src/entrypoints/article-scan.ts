// SPDX-License-Identifier: MPL-2.0
import { ArticleStructureScanner, type ArticlePageSnapshot } from '../article';

const MAX_TEXT_LENGTH = 2_000_000;
const MAX_ELEMENTS = 5_000;

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

export default defineUnlistedScript({
  globalName: true,
  main() {
    return new ArticleStructureScanner().scan(captureArticleSnapshot());
  },
});
