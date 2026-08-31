// SPDX-License-Identifier: MPL-2.0
import type { ArticleStructureDetection } from '../article';

const PREFIX = 'protpeek';

export interface ScanPayload {
  error?: string;
  structures: ArticleStructureDetection[];
  tabId: number;
}

export interface LoadPayload {
  identifier: string;
}

export function scanStorageKey(windowId: number): string {
  return `${PREFIX}.scan.${windowId}`;
}

export function loadStorageKey(windowId: number): string {
  return `${PREFIX}.load.${windowId}`;
}
