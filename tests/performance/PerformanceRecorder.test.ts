// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import { PerformanceRecorder } from '../../src/performance/PerformanceRecorder';

describe('PerformanceRecorder', () => {
  it('stores defensive copies and keeps only the latest 20 loads', () => {
    const recorder = new PerformanceRecorder();
    for (let index = 0; index < 24; index += 1) {
      recorder.record(`load-${index}`, index, index > 0, {
        parseMs: index,
        totalMs: index + 1,
      });
    }

    const records = recorder.records();
    expect(records).toHaveLength(20);
    expect(records[0]?.label).toBe('load-4');
    expect(records.at(-1)?.label).toBe('load-23');
    expect(Date.parse(records[0]?.capturedAt ?? '')).not.toBeNaN();
  });
});
