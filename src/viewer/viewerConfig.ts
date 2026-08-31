// SPDX-License-Identifier: MPL-2.0
export type AdaptiveQuality = 'high' | 'medium' | 'low' | 'lowest';

export interface QualityProfile {
  quality: AdaptiveQuality;
  surfaceResolution: number;
  tier: 'small' | 'medium' | 'large' | 'huge';
}

export function qualityForAtomCount(atomCount: number): QualityProfile {
  if (atomCount < 50_000) {
    return { quality: 'high', surfaceResolution: 0.8, tier: 'small' };
  }
  if (atomCount < 250_000) {
    return { quality: 'medium', surfaceResolution: 1.1, tier: 'medium' };
  }
  if (atomCount < 1_000_000) {
    return { quality: 'low', surfaceResolution: 1.5, tier: 'large' };
  }
  return { quality: 'lowest', surfaceResolution: 2.2, tier: 'huge' };
}

export function cappedPixelRatio(
  devicePixelRatio: number,
  maximumEffectiveRatio = 1.5,
): number {
  if (!Number.isFinite(devicePixelRatio) || devicePixelRatio <= 0) return 1;
  const maximum =
    Number.isFinite(maximumEffectiveRatio) && maximumEffectiveRatio > 0
      ? maximumEffectiveRatio
      : 1.5;
  return Math.min(devicePixelRatio, maximum);
}

export function pixelScaleForQuality(
  preferredPixelScale: number,
  tier: QualityProfile['tier'],
): number {
  const preferred = cappedPixelRatio(preferredPixelScale);
  if (tier === 'medium') return Math.min(preferred, 1.25);
  if (tier === 'large' || tier === 'huge') return Math.min(preferred, 1);
  return preferred;
}
