// SPDX-License-Identifier: MPL-2.0

export const IMAGE_EXPORT_LONG_EDGE = 2560;

export interface ImageExportDimensions {
  height: number;
  width: number;
}

/**
 * Preserves the live viewport aspect ratio while targeting a high-resolution
 * long edge that remains within Mol*'s GPU-specific screenshot limit.
 */
export function imageExportDimensions(
  viewportWidth: number,
  viewportHeight: number,
  maximumDimension: number,
): ImageExportDimensions {
  if (
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(viewportHeight) ||
    !Number.isFinite(maximumDimension) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    maximumDimension < 128
  ) {
    throw new Error('A valid viewport is required to export an image');
  }

  const longEdge = Math.max(viewportWidth, viewportHeight);
  const targetLongEdge = Math.min(
    maximumDimension,
    Math.max(longEdge, IMAGE_EXPORT_LONG_EDGE),
  );
  const scale = targetLongEdge / longEdge;
  return {
    height: Math.max(128, Math.round(viewportHeight * scale)),
    width: Math.max(128, Math.round(viewportWidth * scale)),
  };
}
