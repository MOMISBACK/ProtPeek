// SPDX-License-Identifier: MPL-2.0
import type { ScanPayload } from '../browser/sessionPayloads';

/** The small, read-only slice of Zotero used by ProtPeek. */
export interface ZoteroItem {
  id: number;
  parentID?: number | false;
  attachmentContentType: string;
  attachmentText: Promise<string>;
  isAttachment(): boolean;
  isRegularItem(): boolean;
  getField(field: string): string;
  getAttachments(): number[];
  getBestAttachment(): Promise<ZoteroItem | false>;
  getFilePathAsync(): Promise<string | false>;
}

export interface ZoteroArticleHost {
  Items: { getAsync(id: number): Promise<ZoteroItem | false> };
  PDFWorker: {
    getFullText: (id: number, maxPages: null, priority: boolean) => Promise<{ text: string }>;
  };
}

export interface ZoteroScanResult extends ScanPayload {
  title: string;
}

/** No Zotero object or filesystem API is exposed to the viewer. */
export interface ZoteroPanelBridge {
  itemId: number;
  title: string;
  initialIdentifier?: string;
  scan: () => Promise<ZoteroScanResult>;
}
