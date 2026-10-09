// SPDX-License-Identifier: MPL-2.0
import type { ViewerBackground } from '../viewer/StructureViewer';

export const VIEWER_BACKGROUND_STORAGE_KEY = 'protpeek:viewer-background';

interface PreferenceStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

/** Browser-local preference, with an in-memory fallback for the Zotero UI. */
export class ViewerBackgroundPreference {
  readonly #storage: PreferenceStorage | undefined;
  #value: ViewerBackground = 'white';
  #revision = 0;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(storage?: PreferenceStorage) {
    this.#storage = storage;
  }

  async read(): Promise<ViewerBackground> {
    const revision = this.#revision;
    const values = await this.#storage?.get([VIEWER_BACKGROUND_STORAGE_KEY]);
    const stored = values?.[VIEWER_BACKGROUND_STORAGE_KEY];
    // A late initial read must not replace a choice the user has just made.
    if (revision === this.#revision && (stored === 'white' || stored === 'black')) {
      this.#value = stored;
    }
    return this.#value;
  }

  set(background: ViewerBackground): Promise<void> {
    this.#value = background;
    this.#revision += 1;
    // Keep writes ordered, while allowing a later save after a storage failure.
    this.#writeQueue = this.#writeQueue.catch(() => undefined).then(async () => {
      await this.#storage?.set({ [VIEWER_BACKGROUND_STORAGE_KEY]: background });
    });
    return this.#writeQueue;
  }
}
