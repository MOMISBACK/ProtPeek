// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  cappedPixelRatio,
  pixelScaleForQuality,
  qualityForAtomCount,
} from '../../src/viewer/viewerConfig';

describe('viewerConfig', () => {
  it('caps effective Retina resolution', () => {
    expect(cappedPixelRatio(3)).toBe(1.5);
    expect(cappedPixelRatio(1)).toBe(1);
    expect(cappedPixelRatio(Number.NaN)).toBe(1);
    expect(cappedPixelRatio(2, 0)).toBe(1.5);
  });

  it('reduces render resolution as structure size increases', () => {
    expect(pixelScaleForQuality(1.5, 'small')).toBe(1.5);
    expect(pixelScaleForQuality(1.5, 'medium')).toBe(1.25);
    expect(pixelScaleForQuality(1.5, 'large')).toBe(1);
    expect(pixelScaleForQuality(1.5, 'huge')).toBe(1);
    expect(pixelScaleForQuality(0.8, 'huge')).toBe(0.8);
  });

  it('degrades geometry quality for very large assemblies', () => {
    expect(qualityForAtomCount(5_000).tier).toBe('small');
    expect(qualityForAtomCount(2_000_000)).toMatchObject({
      quality: 'lowest',
      tier: 'huge',
    });
  });
});
