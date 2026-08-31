// SPDX-License-Identifier: MPL-2.0
export interface SidePanelTabActivatedMessage {
  tabId: number;
  type: 'protpeek-side-panel-tab-activated';
  windowId: number;
}

export const ACTIVATION_REFRESH_DELAY_MS = 100;
const COMPLETION_COALESCE_WINDOW_MS = 250;

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
