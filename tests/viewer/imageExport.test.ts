// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  IMAGE_EXPORT_LONG_EDGE,
  imageExportDimensions,
} from '../../src/viewer/imageExport';

describe('high-resolution image export dimensions', () => {
  it('upscales the live viewport to a 2560 px long edge', () => {
    expect(imageExportDimensions(640, 400, 4096)).toEqual({
      height: 1600,
      width: IMAGE_EXPORT_LONG_EDGE,
    });
  });

  it('preserves portrait aspect ratios', () => {
    expect(imageExportDimensions(320, 640, 4096)).toEqual({
      height: IMAGE_EXPORT_LONG_EDGE,
      width: 1280,
    });
  });

  it('honours lower GPU limits and does not downscale larger supported views', () => {
    expect(imageExportDimensions(640, 400, 2048)).toEqual({
      height: 1280,
      width: 2048,
    });
    expect(imageExportDimensions(3000, 1500, 4096)).toEqual({
      height: 1500,
      width: 3000,
    });
  });

  it('rejects invalid or unusable dimensions', () => {
    expect(() => imageExportDimensions(0, 400, 4096)).toThrow();
    expect(() => imageExportDimensions(640, 400, 64)).toThrow();
  });
});
