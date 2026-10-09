// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';

import {
  loadLocalStructure,
  localFileFormat,
} from '../../../src/structures/loaders/local';

function fileStub(options: {
  name: string;
  size: number;
  text?: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}): File {
  return options as unknown as File;
}

describe('local structure loader', () => {
  it.each([
    ['model.cif', { format: 'mmcif', isBinary: false }],
    ['model.mmcif', { format: 'mmcif', isBinary: false }],
    ['model.BCIF', { format: 'mmcif', isBinary: true }],
    ['model.PDB', { format: 'pdb', isBinary: false }],
    ['model.gro', { format: 'gro', isBinary: false }],
    ['simulation.GRO', { format: 'gro', isBinary: false }],
    ['complex.name.cif', { format: 'mmcif', isBinary: false }],
  ] as const)('recognizes %s', (name, expected) => {
    expect(localFileFormat(name)).toEqual(expected);
  });

  it.each([
    'model',
    'model.txt',
    'model.ent',
    'model.cif.gz',
    'model.cif ',
    'model.bcif.tmp',
    'model.gro.gz',
    'model.gro.tmp',
  ])('rejects unsupported filename %s', (name) => {
    expect(localFileFormat(name)).toBeNull();
  });

  it('reads textual coordinates locally and preserves source metadata', async () => {
    const file = new File(['data_local'], 'protein.mmcif');

    await expect(
      loadLocalStructure(file, new AbortController().signal),
    ).resolves.toEqual({
      data: 'data_local',
      format: 'mmcif',
      isBinary: false,
      label: 'protein.mmcif',
      source: { kind: 'local', name: 'protein.mmcif' },
    });
  });

  it('reads BCIF as bytes rather than decoding it as text', async () => {
    const file = new File([Uint8Array.from([0, 1, 255])], 'protein.bcif');
    const result = await loadLocalStructure(
      file,
      new AbortController().signal,
    );

    expect(result.isBinary).toBe(true);
    expect(result.data).toEqual(Uint8Array.from([0, 1, 255]));
  });

  it('keeps legacy local PDB support textual', async () => {
    const file = new File(['ATOM'], 'legacy.pdb');
    const result = await loadLocalStructure(
      file,
      new AbortController().signal,
    );

    expect(result).toMatchObject({ data: 'ATOM', format: 'pdb', isBinary: false });
  });

  it('passes GRO text to its native parser without changing coordinate units', async () => {
    const data = 'Protein\n1\n    1ALA     CA    1   0.100   0.200   0.300\n   1.0   1.0   1.0\n';
    const result = await loadLocalStructure(
      new File([data], 'protein.gro'),
      new AbortController().signal,
    );

    expect(result).toEqual({
      data,
      format: 'gro',
      isBinary: false,
      label: 'protein.gro',
      source: { kind: 'local', name: 'protein.gro' },
    });
  });

  it('rejects unsupported input before attempting to read it', async () => {
    const text = vi.fn(async () => 'content');
    const file = fileStub({ name: 'notes.txt', size: 7, text });

    await expect(
      loadLocalStructure(file, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'unsupported-file' });
    expect(text).not.toHaveBeenCalled();
  });

  it('rejects an empty file', async () => {
    await expect(
      loadLocalStructure(
        new File([], 'empty.cif'),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'invalid-file' });
  });

  it('rejects files above the 512 MiB safety limit without reading', async () => {
    const text = vi.fn(async () => 'content');
    const file = fileStub({
      name: 'huge.cif',
      size: 512 * 1024 * 1024 + 1,
      text,
    });

    await expect(
      loadLocalStructure(file, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'file-too-large' });
    expect(text).not.toHaveBeenCalled();
  });

  it('accepts a file exactly at the configured safety limit', async () => {
    const file = fileStub({
      name: 'boundary.cif',
      size: 512 * 1024 * 1024,
      text: async () => 'small test stand-in',
    });

    await expect(
      loadLocalStructure(file, new AbortController().signal),
    ).resolves.toMatchObject({ data: 'small test stand-in' });
  });

  it('honors an already-aborted signal before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    const text = vi.fn(async () => 'content');
    const file = fileStub({ name: 'protein.cif', size: 7, text });

    await expect(
      loadLocalStructure(file, controller.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(text).not.toHaveBeenCalled();
  });

  it('does not publish data when cancellation occurs during reading', async () => {
    const controller = new AbortController();
    const file = fileStub({
      name: 'protein.cif',
      size: 7,
      text: async () => {
        controller.abort();
        return 'content';
      },
    });

    await expect(
      loadLocalStructure(file, controller.signal),
    ).rejects.toMatchObject({ code: 'aborted' });
  });
});

