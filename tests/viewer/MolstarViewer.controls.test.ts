// SPDX-License-Identifier: MPL-2.0
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createContext = vi.hoisted(() => vi.fn<() => object>());

vi.mock('molstar/lib/mol-plugin/context.js', () => ({
  PluginContext: class {
    constructor() {
      return createContext();
    }
  },
}));

import { MolstarViewer } from '../../src/viewer/MolstarViewer';

function fakeContext() {
  const setProps = vi.fn();
  const requestAbortAll = vi.fn();
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(() => ({ unsubscribe }));
  return {
    init: vi.fn(async () => undefined),
    mountAsync: vi.fn(async () => true),
    canvas3d: { setProps },
    canvas3dContext: { setProps: vi.fn() },
    managers: {
      interactivity: { setProps: vi.fn() },
      task: { requestAbortAll },
    },
    behaviors: { interaction: { click: { subscribe }, hover: { subscribe } } },
    clear: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
}

describe('MolstarViewer controls', () => {
  beforeEach(() => createContext.mockReset());

  async function prepare() {
    const plugin = fakeContext();
    createContext.mockReturnValue(plugin);
    const viewer = await MolstarViewer.create({} as HTMLElement);
    return { plugin, viewer };
  }

  it('uses native trackball spin and disables it without changing other canvas settings', async () => {
    const { plugin, viewer } = await prepare();

    viewer.setAutoRotate(true);
    expect(plugin.canvas3d.setProps).toHaveBeenLastCalledWith({
      trackball: {
        animate: { name: 'spin', params: { speed: 0.05, axis: [0, 1, 0] } },
      },
    });

    viewer.setAutoRotate(false);
    expect(plugin.canvas3d.setProps).toHaveBeenLastCalledWith({
      trackball: { animate: { name: 'off', params: {} } },
    });
    viewer.dispose();
  });

  it('stops rotation before clearing a structure', async () => {
    const { plugin, viewer } = await prepare();
    viewer.setAutoRotate(true);
    await viewer.clear();

    expect(plugin.canvas3d.setProps).toHaveBeenLastCalledWith({
      trackball: { animate: { name: 'off', params: {} } },
    });
    expect(plugin.canvas3d.setProps.mock.invocationCallOrder.at(-1))
      .toBeLessThan(plugin.clear.mock.invocationCallOrder[0]!);
    expect(plugin.clear).toHaveBeenCalledOnce();
    viewer.dispose();
  });

  it('stops rotation before replacing the structure, even if the new file cannot load', async () => {
    const { plugin, viewer } = await prepare();
    viewer.setAutoRotate(true);
    // The fake context has no structure builders, so loading fails after clear.
    await expect(viewer.load({
      data: 'invalid',
      format: 'pdb',
      isBinary: false,
      label: 'invalid.pdb',
      source: { kind: 'local', name: 'invalid.pdb' },
    })).rejects.toThrow('The structure could not be parsed or rendered');

    expect(plugin.canvas3d.setProps).toHaveBeenLastCalledWith({
      trackball: { animate: { name: 'off', params: {} } },
    });
    expect(plugin.clear).toHaveBeenCalledOnce();
    viewer.dispose();
  });

  it('stops rotation before disposal and ignores late control events', async () => {
    const { plugin, viewer } = await prepare();
    viewer.setAutoRotate(true);
    viewer.dispose();

    expect(plugin.canvas3d.setProps).toHaveBeenLastCalledWith({
      trackball: { animate: { name: 'off', params: {} } },
    });
    expect(plugin.canvas3d.setProps.mock.invocationCallOrder.at(-1))
      .toBeLessThan(plugin.dispose.mock.invocationCallOrder[0]!);

    plugin.canvas3d.setProps.mockClear();
    viewer.setAutoRotate(true);
    viewer.dispose();
    expect(plugin.canvas3d.setProps).not.toHaveBeenCalled();
    expect(plugin.dispose).toHaveBeenCalledOnce();
  });
});
