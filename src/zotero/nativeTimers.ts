// SPDX-License-Identifier: MPL-2.0
// Mol* normally schedules work through postMessage and checks event.source.
// Firefox chrome:// windows report a null source, so that work never resumes.
// Provide its supported setImmediate alternative before Mol* is imported.
Object.assign(window, {
  setImmediate(callback: (...args: unknown[]) => void, ...args: unknown[]): number {
    return window.setTimeout(callback, 0, ...args);
  },
  clearImmediate(handle: number): void {
    window.clearTimeout(handle);
  },
});
