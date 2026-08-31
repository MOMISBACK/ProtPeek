// SPDX-License-Identifier: MPL-2.0
export const logger = {
  error(message: string, error?: unknown): void {
    if (import.meta.env.DEV) console.error(`[ProtPeek] ${message}`, error);
  },
  warn(message: string, error?: unknown): void {
    if (import.meta.env.DEV) console.warn(`[ProtPeek] ${message}`, error);
  },
};
