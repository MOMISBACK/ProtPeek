// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import { LazyStructureViewer } from '../../src/viewer/LazyStructureViewer';
import type { StructureViewer } from '../../src/viewer/StructureViewer';

function fakeViewer(dispose = vi.fn(), setBackground = vi.fn()): StructureViewer {
  return { dispose, setBackground } as unknown as StructureViewer;
}

describe('LazyStructureViewer', () => {
  it('applies a saved background lazily and preserves it on loads and camera reset', async () => {
    const setBackground = vi.fn();
    const resetCamera = vi.fn();
    const structureViewer = {
      dispose: vi.fn(),
      load: vi.fn(async () => ({ metadata: {}, timings: {} })),
      resetCamera,
      setBackground,
    } as unknown as StructureViewer;
    const createViewer = vi.fn(async () => structureViewer);
    const viewer = new LazyStructureViewer({} as HTMLElement, {}, createViewer);

    await viewer.setBackground('black');
    expect(createViewer).not.toHaveBeenCalled();
    await viewer.prepare();
    expect(setBackground).toHaveBeenCalledWith('black');

    const structure = {
      data: 'data_empty',
      format: 'mmcif' as const,
      isBinary: false,
      label: 'empty.cif',
      source: { kind: 'local' as const, name: 'empty.cif' },
    };
    await viewer.load(structure);
    await viewer.withViewer((current) => current.resetCamera());
    await viewer.load(structure);
    expect(setBackground).toHaveBeenCalledOnce();
    expect(resetCamera).toHaveBeenCalledOnce();
    await viewer.setBackground('white');
    expect(setBackground).toHaveBeenLastCalledWith('white');
  });

  it('uses the newest background when creation is still pending', async () => {
    const setBackground = vi.fn();
    const structureViewer = fakeViewer(vi.fn(), setBackground);
    let resolveViewer!: (viewer: StructureViewer) => void;
    const viewer = new LazyStructureViewer({} as HTMLElement, {}, () =>
      new Promise<StructureViewer>((resolve) => { resolveViewer = resolve; }),
    );
    const preparing = viewer.prepare();
    await Promise.resolve();
    const white = viewer.setBackground('white');
    const black = viewer.setBackground('black');
    resolveViewer(structureViewer);
    await Promise.all([preparing, white, black]);
    expect(setBackground).toHaveBeenCalledWith('black');
    expect(setBackground).not.toHaveBeenCalledWith('white');
  });

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
