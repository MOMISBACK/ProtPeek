// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { resolveArticleAttachment, scanZoteroArticle } from '../../src/zotero/article';
import type { ZoteroArticleHost, ZoteroItem } from '../../src/zotero/types';

function attachment(overrides: Partial<ZoteroItem> = {}): ZoteroItem {
  return {
    id: 11,
    attachmentContentType: 'application/pdf',
    attachmentText: Promise.resolve('PDB 9XYZ'),
    isAttachment: () => true,
    isRegularItem: () => false,
    getField: (field) => field === 'title' ? 'Test paper.pdf' : '',
    getAttachments: () => [],
    getBestAttachment: () => Promise.resolve(false),
    getFilePathAsync: () => Promise.resolve('/local/Test.pdf'),
    ...overrides,
  };
}

function host(items: ZoteroItem[], text = 'Data availability: PDB 1CRN, 1AON.'): ZoteroArticleHost {
  return {
    Items: { getAsync: vi.fn((id: number): Promise<ZoteroItem | false> => Promise.resolve(items.find((item) => item.id === id) ?? false)) },
    PDFWorker: { getFullText: vi.fn(() => Promise.resolve({ text })) },
  };
}

describe('Zotero article integration', () => {
  it('reads every local PDF page and uses the existing contextual scanner', async () => {
    const pdf = attachment();
    const api = host([pdf]);
    const result = await scanZoteroArticle(api, pdf);
    expect(api.PDFWorker.getFullText).toHaveBeenCalledWith(11, null, true);
    expect(result.structures.map(({ id }) => id)).toEqual(['1crn', '1aon']);
    expect(result.tabId).toBe(11);
    expect(result.error).toBeUndefined();
  });

  it('never downloads a missing attachment or invokes PDF extraction for it', async () => {
    const pdf = attachment({ getFilePathAsync: () => Promise.resolve(false) });
    const api = host([pdf]);
    const result = await scanZoteroArticle(api, pdf);
    expect(api.PDFWorker.getFullText).not.toHaveBeenCalled();
    expect(result.structures).toEqual([]);
    expect(result.error).toContain('Download it in Zotero first');
  });

  it('reports image-only documents instead of claiming that no structures exist', async () => {
    const pdf = attachment();
    const result = await scanZoteroArticle(host([pdf], '  '), pdf);
    expect(result.error).toContain('OCR is not included');
  });

  it('reads HTML locally without passing it to the PDF worker', async () => {
    const html = attachment({ attachmentContentType: 'text/html' });
    const api = host([html]);
    const result = await scanZoteroArticle(api, html);
    expect(api.PDFWorker.getFullText).not.toHaveBeenCalled();
    expect(result.structures[0]?.id).toBe('9xyz');
  });

  it('resolves a parent reference to its PDF instead of scanning unrelated items', async () => {
    const pdf = attachment();
    const parent = attachment({ id: 10, isAttachment: () => false, isRegularItem: () => true, getBestAttachment: () => Promise.resolve(pdf) });
    expect(await resolveArticleAttachment(host([parent, pdf]), 10)).toBe(pdf);
  });

  it('falls back from an unsupported best attachment to a supported local attachment', async () => {
    const pdf = attachment();
    const epub = attachment({ id: 12, attachmentContentType: 'application/epub+zip' });
    const parent = attachment({ id: 10, isAttachment: () => false, isRegularItem: () => true, getBestAttachment: () => Promise.resolve(epub), getAttachments: () => [12, 11] });
    expect(await resolveArticleAttachment(host([parent, epub, pdf]), 10)).toBe(pdf);
  });

  it('handles deleted items and unsupported selections with an actionable error', async () => {
    await expect(resolveArticleAttachment(host([]), 99)).rejects.toThrow('no longer available');
    const epub = attachment({ attachmentContentType: 'application/epub+zip' });
    await expect(resolveArticleAttachment(host([epub]), 11)).rejects.toThrow('PDF or an HTML');
  });

  it('surfaces PDF extraction failures without uploading the document', async () => {
    const pdf = attachment();
    const api = host([pdf]);
    api.PDFWorker.getFullText = vi.fn(() => Promise.reject(new Error('Password required')));
    expect((await scanZoteroArticle(api, pdf)).error).toBe('Password required');
  });
});
