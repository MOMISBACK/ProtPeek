// SPDX-License-Identifier: MPL-2.0
export const REVIEW_PROMPT_STORAGE_KEY = 'protpeek:review-prompt';
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AGE_MS = 7 * DAY_MS;
const MIN_ACTIVE_DAYS = 5;
const REMINDER_DELAY_MS = 30 * DAY_MS;
const MAX_PROMPTS = 2;

interface ReviewStorage {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface ReviewState {
  firstUsedAt: number;
  lastUsedDay: string;
  activeDays: number;
  promptCount: number;
  nextPromptAt: number;
  dismissed: boolean;
}

function parseState(value: unknown): ReviewState | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const state = value as Partial<ReviewState>;
  if (
    typeof state.firstUsedAt !== 'number' || !Number.isFinite(state.firstUsedAt) || state.firstUsedAt < 0 ||
    typeof state.lastUsedDay !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(state.lastUsedDay) ||
    typeof state.activeDays !== 'number' || !Number.isSafeInteger(state.activeDays) || state.activeDays < 1 ||
    typeof state.promptCount !== 'number' || !Number.isSafeInteger(state.promptCount) || state.promptCount < 0 ||
    typeof state.nextPromptAt !== 'number' || !Number.isFinite(state.nextPromptAt) || state.nextPromptAt < 0 ||
    typeof state.dismissed !== 'boolean'
  ) return undefined;
  return state as ReviewState;
}

/** Local scheduling only: never stores identifiers, files, URLs or review content. */
export class ReviewPromptSchedule {
  readonly #storage: ReviewStorage;
  readonly #now: () => number;
  #queue: Promise<unknown> = Promise.resolve();
  #visible = false;
  #stopped = false;

  constructor(storage: ReviewStorage, now: () => number = Date.now) {
    this.#storage = storage;
    this.#now = now;
  }

  /** Called only after a structure is successfully displayed. */
  recordSuccessfulUse(): Promise<boolean> {
    return this.#serialize(async () => {
      if (this.#stopped || this.#visible) return false;
      const now = this.#now();
      const day = new Date(now).toISOString().slice(0, 10);
      const values = await this.#storage.get([REVIEW_PROMPT_STORAGE_KEY]);
      if (this.#stopped) return false;
      const state = parseState(values[REVIEW_PROMPT_STORAGE_KEY]) ?? {
        firstUsedAt: now, lastUsedDay: day, activeDays: 1,
        promptCount: 0, nextPromptAt: 0, dismissed: false,
      };
      if (state.dismissed || state.promptCount >= MAX_PROMPTS) return false;
      // At most one active day per calendar day; a clock moving backwards
      // cannot increment the counter or bypass the age/cooldown requirements.
      if (day > state.lastUsedDay) {
        state.activeDays = Math.min(MIN_ACTIVE_DAYS, state.activeDays + 1);
        state.lastUsedDay = day;
      }
      const eligible = now - state.firstUsedAt >= MIN_AGE_MS &&
        state.activeDays >= MIN_ACTIVE_DAYS && now >= state.nextPromptAt;
      if (eligible) {
        state.promptCount += 1;
        // Also applies when the banner is ignored or the panel is closed.
        state.nextPromptAt = now + REMINDER_DELAY_MS;
      }
      await this.#storage.set({ [REVIEW_PROMPT_STORAGE_KEY]: state });
      if (this.#stopped) return false;
      this.#visible = eligible;
      return eligible;
    });
  }

  later(): void {
    // Cooldown was persisted before the banner appeared.
    this.#visible = false;
  }

  dismiss(): Promise<void> {
    this.#stopped = true;
    this.#visible = false;
    return this.#serialize(async () => {
      const values = await this.#storage.get([REVIEW_PROMPT_STORAGE_KEY]);
      const state = parseState(values[REVIEW_PROMPT_STORAGE_KEY]);
      if (state === undefined) return;
      await this.#storage.set({
        [REVIEW_PROMPT_STORAGE_KEY]: { ...state, dismissed: true },
      });
    });
  }

  dispose(): void {
    this.#stopped = true;
    this.#visible = false;
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation);
    this.#queue = result.catch(() => {
      // A storage failure disables requests for this panel session.
      this.#stopped = true;
    });
    return result;
  }
}
