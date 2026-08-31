// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import { LazyStructureViewer } from '../../src/viewer/LazyStructureViewer';
import type { StructureViewer } from '../../src/viewer/StructureViewer';

function fakeViewer(dispose = vi.fn()): StructureViewer {
  return { dispose } as unknown as StructureViewer;
}

describe('LazyStructureViewer', () => {
  it('prepares the viewer once across concurrent calls', async () => {
    const structureViewer = fakeViewer();
    const createViewer = vi.fn(async () => structureViewer);
    const viewer = new LazyStructureViewer(
      {} as HTMLElement,
      {},
      createViewer,
    );

    expect(viewer.initialized).toBe(false);
    const first = viewer.prepare();
    const second = viewer.prepare();

    expect(viewer.initialized).toBe(true);
    await Promise.all([first, second]);
    expect(createViewer).toHaveBeenCalledOnce();

    const operation = vi.fn();
    await viewer.withViewer(operation);
    expect(operation).toHaveBeenCalledWith(structureViewer);
  });

  it('allows a preparation retry after initialization fails', async () => {
    const structureViewer = fakeViewer();
    let attempts = 0;
    const createViewer = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('Initialization failed');
      return structureViewer;
    });
    const viewer = new LazyStructureViewer(
      {} as HTMLElement,
      {},
      createViewer,
    );

    await expect(viewer.prepare()).rejects.toThrow('Initialization failed');
    expect(viewer.initialized).toBe(false);

    await expect(viewer.prepare()).resolves.toBeUndefined();
    expect(viewer.initialized).toBe(true);
    expect(createViewer).toHaveBeenCalledTimes(2);
  });

  it('disposes a viewer that finishes initializing after disposal', async () => {
    const dispose = vi.fn();
    const structureViewer = fakeViewer(dispose);
    let resolveViewer!: (viewer: StructureViewer) => void;
    const createViewer = vi.fn(
      () => new Promise<StructureViewer>((resolve) => {
        resolveViewer = resolve;
      }),
    );
    const viewer = new LazyStructureViewer(
      {} as HTMLElement,
      {},
      createViewer,
    );

    const preparation = viewer.prepare();
    const rejection = expect(preparation).rejects.toThrow('Viewer has been disposed');
    await Promise.resolve();
    viewer.dispose();
    resolveViewer(structureViewer);

    await rejection;
    expect(dispose).toHaveBeenCalledOnce();
    expect(viewer.initialized).toBe(false);
    await expect(viewer.prepare()).rejects.toThrow('Viewer has been disposed');
    expect(createViewer).toHaveBeenCalledOnce();
  });

  it('does not initialize again after disposal', async () => {
    const viewer = new LazyStructureViewer({} as HTMLElement);
    viewer.dispose();

    await expect(viewer.load({
      data: 'data_empty',
      format: 'mmcif',
      isBinary: false,
      label: 'empty.cif',
      source: { kind: 'local', name: 'empty.cif' },
    })).rejects.toThrow('Viewer has been disposed');
    expect(viewer.initialized).toBe(false);
  });

  it('keeps no-op lifecycle calls safe before initialization', async () => {
    const viewer = new LazyStructureViewer({} as HTMLElement);
    const operation = vi.fn();

    viewer.resize();
    await viewer.withViewer(operation);
    viewer.dispose();

    expect(operation).not.toHaveBeenCalled();
  });
});
