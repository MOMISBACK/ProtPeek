// SPDX-License-Identifier: MPL-2.0
import { ArticleStructureScanner } from '../article';
import type { ZoteroArticleHost, ZoteroItem, ZoteroScanResult } from './types';

export function isSupportedAttachment(item: ZoteroItem): boolean {
  return item.isAttachment() && (
    item.attachmentContentType === 'application/pdf'
    || item.attachmentContentType === 'text/html'
    || item.attachmentContentType === 'application/xhtml+xml'
  );
}

export async function resolveArticleAttachment(
  host: ZoteroArticleHost,
  itemId: number,
): Promise<ZoteroItem> {
  const item = await host.Items.getAsync(itemId);
  if (!item) throw new Error('This item is no longer available in Zotero.');
  if (isSupportedAttachment(item)) return item;
  if (item.isRegularItem()) {
    const best = await item.getBestAttachment();
    if (best && isSupportedAttachment(best)) return best;
    for (const attachmentId of item.getAttachments()) {
      const attachment = await host.Items.getAsync(attachmentId);
      if (attachment && isSupportedAttachment(attachment)) return attachment;
    }
  }
  throw new Error('Select a paper with a PDF or an HTML attachment in Zotero.');
}

export async function scanZoteroArticle(
  host: ZoteroArticleHost,
  attachment: ZoteroItem,
): Promise<ZoteroScanResult> {
  const title = attachment.getField('title') || 'Zotero attachment';
  const result = { tabId: attachment.id, title, structures: [] };
  try {
    if (!await attachment.getFilePathAsync()) {
      throw new Error('This attachment is not available locally. Download it in Zotero first.');
    }
    // Read every PDF page directly, rather than relying on a potentially
    // truncated or missing full-text index. This does not change the library.
    const text = attachment.attachmentContentType === 'application/pdf'
      ? (await host.PDFWorker.getFullText(attachment.id, null, true)).text
      : await attachment.attachmentText;
    if (!text.trim()) {
      throw new Error('No extractable text in this document. Use Open to enter an identifier; OCR is not included.');
    }
    const parent = attachment.parentID
      ? await host.Items.getAsync(attachment.parentID)
      : false;
    const metadata = parent
      ? ['title', 'abstractNote', 'extra'].map((field) => ({
          name: field,
          content: parent.getField(field),
        }))
      : [];
    return {
      ...result,
      structures: new ArticleStructureScanner().scan({
        text,
        metadata,
        url: parent ? parent.getField('url') : attachment.getField('url'),
      }),
    };
  } catch (error: unknown) {
    return {
      ...result,
      error: error instanceof Error ? error.message : 'This document could not be scanned.',
    };
  }
}
