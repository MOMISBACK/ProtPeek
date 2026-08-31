// SPDX-License-Identifier: MPL-2.0
import type { LoadTimings } from '../structures/types';

export interface FrameSample {
  durationMs: number;
  fps: number;
  frames: number;
  framesOver33Ms: number;
  worstFrameMs: number;
}

export interface LoadPerformanceRecord {
  atomCount: number;
  capturedAt: string;
  label: string;
  replacing: boolean;
  timings: LoadTimings;
  usedJsHeapBytes?: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize?: number };
}

export function readUsedJsHeapBytes(): number | undefined {
  const value = (performance as PerformanceWithMemory).memory?.usedJSHeapSize;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export async function sampleAnimationFrames(durationMs = 2_000): Promise<FrameSample> {
  const safeDuration = Math.max(250, Math.min(durationMs, 30_000));
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let previousAt = startedAt;
    let frames = 0;
    let framesOver33Ms = 0;
    let worstFrameMs = 0;
    let frameRequest: number | undefined;
    let settled = false;

    const finish = (now: number): void => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(fallback);
      if (frameRequest !== undefined) cancelAnimationFrame(frameRequest);
      const elapsed = Math.max(0, now - startedAt);
      resolve({
        durationMs: Number(elapsed.toFixed(1)),
        fps: Number(((Math.max(0, frames - 1) / Math.max(1, elapsed)) * 1_000).toFixed(1)),
        frames: Math.max(0, frames - 1),
        framesOver33Ms,
        worstFrameMs: Number(worstFrameMs.toFixed(1)),
      });
    };

    // requestAnimationFrame may be fully suspended in a background extension page.
    // Keep the development benchmark bounded instead of leaving CDP automation hanging.
    const fallback = globalThis.setTimeout(
      () => finish(performance.now()),
      safeDuration + 1_000,
    );

    const sample = (now: number): void => {
      const frameMs = now - previousAt;
      previousAt = now;
      if (frames > 0) {
        worstFrameMs = Math.max(worstFrameMs, frameMs);
        if (frameMs > 33.34) framesOver33Ms += 1;
      }
      frames += 1;
      const elapsed = now - startedAt;
      if (elapsed < safeDuration) {
        frameRequest = requestAnimationFrame(sample);
        return;
      }
      finish(now);
    };
    frameRequest = requestAnimationFrame(sample);
  });
}

export class PerformanceRecorder {
  readonly #records: LoadPerformanceRecord[] = [];

  record(
    label: string,
    atomCount: number,
    replacing: boolean,
    timings: LoadTimings,
  ): LoadPerformanceRecord {
    const usedJsHeapBytes = readUsedJsHeapBytes();
    const record: LoadPerformanceRecord = {
      atomCount,
      capturedAt: new Date().toISOString(),
      label,
      replacing,
      timings: { ...timings },
      ...(usedJsHeapBytes === undefined ? {} : { usedJsHeapBytes }),
    };
    this.#records.push(record);
    if (this.#records.length > 20) this.#records.shift();
    return record;
  }

  records(): readonly LoadPerformanceRecord[] {
    return this.#records.map((record) => ({
      ...record,
      timings: { ...record.timings },
    }));
  }
}
