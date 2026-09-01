// SPDX-License-Identifier: MPL-2.0
export interface SidePanelTabActivatedMessage {
  tabId: number;
  type: 'protpeek-side-panel-tab-activated';
  windowId: number;
}

export interface ArticlePageChangedMessage {
  type: 'protpeek-article-page-changed';
}

export const ACTIVATION_REFRESH_DELAY_MS = 100;
export const ARTICLE_CHANGE_REFRESH_DELAY_MS = 500;
export const ARTICLE_CHANGE_MAX_WAIT_MS = 2_000;
const COMPLETION_COALESCE_WINDOW_MS = 250;

/** Coalesces mutation bursts before asking the panel to rescan the page. */
export class ArticleChangeRefreshDebouncer {
  readonly #callback: () => void;
  readonly #delayMs: number;
  readonly #maxWaitMs: number;
  #maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  #trailingTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    callback: () => void,
    delayMs = ARTICLE_CHANGE_REFRESH_DELAY_MS,
    maxWaitMs = ARTICLE_CHANGE_MAX_WAIT_MS,
  ) {
    this.#callback = callback;
    this.#delayMs = delayMs;
    this.#maxWaitMs = Math.max(delayMs, maxWaitMs);
  }

  schedule(): void {
    if (this.#trailingTimer !== undefined) {
      clearTimeout(this.#trailingTimer);
    }
    this.#trailingTimer = setTimeout(() => this.#flush(), this.#delayMs);
    this.#maxWaitTimer ??= setTimeout(
      () => this.#flush(),
      this.#maxWaitMs,
    );
  }

  cancel(): void {
    if (this.#trailingTimer !== undefined) {
      clearTimeout(this.#trailingTimer);
      this.#trailingTimer = undefined;
    }
    if (this.#maxWaitTimer !== undefined) {
      clearTimeout(this.#maxWaitTimer);
      this.#maxWaitTimer = undefined;
    }
  }

  #flush(): void {
    this.cancel();
    this.#callback();
  }
}

/** Avoids a delayed activation scan immediately after a completed-page scan. */
export class TabRefreshDeduper {
  readonly #lastCompletionByTab = new Map<number, number>();

  recordCompletion(tabId: number, now: number): void {
    this.#lastCompletionByTab.set(tabId, now);
  }

  shouldRunActivation(tabId: number, now: number): boolean {
    const completedAt = this.#lastCompletionByTab.get(tabId);
    return (
      completedAt === undefined ||
      now - completedAt >= COMPLETION_COALESCE_WINDOW_MS
    );
  }
}

export function isCompletedActiveTabUpdate(
  status: string | undefined,
  active: boolean,
  tabWindowId: number,
  panelWindowId: number,
): boolean {
  return status === 'complete' && active && tabWindowId === panelWindowId;
}

/**
 * A completed navigation is ready to scan immediately. An URL-only update on
 * an otherwise complete tab represents an in-page/SPA navigation and also
 * needs a fresh snapshot.
 */
export function isRefreshableActiveTabUpdate(
  changedStatus: string | undefined,
  changedUrl: string | undefined,
  tabStatus: string | undefined,
  active: boolean,
  tabWindowId: number,
  panelWindowId: number,
): boolean {
  return (
    active &&
    tabWindowId === panelWindowId &&
    (changedStatus === 'complete' ||
      (changedUrl !== undefined && tabStatus === 'complete'))
  );
}

export function articlePageChangedMessage(): ArticlePageChangedMessage {
  return { type: 'protpeek-article-page-changed' };
}

export function parseArticlePageChangedMessage(
  value: unknown,
): ArticlePageChangedMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = value as Record<string, unknown>;
  return message.type === 'protpeek-article-page-changed'
    ? { type: 'protpeek-article-page-changed' }
    : undefined;
}

export function sidePanelTabActivatedMessage(
  tabId: number,
  windowId: number,
): SidePanelTabActivatedMessage {
  return { tabId, type: 'protpeek-side-panel-tab-activated', windowId };
}

export function parseSidePanelTabActivatedMessage(
  value: unknown,
): SidePanelTabActivatedMessage | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const message = value as Record<string, unknown>;
  if (
    message.type !== 'protpeek-side-panel-tab-activated' ||
    typeof message.tabId !== 'number' ||
    !Number.isSafeInteger(message.tabId) ||
    message.tabId < 0 ||
    typeof message.windowId !== 'number' ||
    !Number.isSafeInteger(message.windowId) ||
    message.windowId < 0
  ) {
    return undefined;
  }
  return {
    tabId: message.tabId,
    type: 'protpeek-side-panel-tab-activated',
    windowId: message.windowId,
  };
}
