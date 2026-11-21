// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it, vi } from 'vitest';
import { createZoteroExportActions } from '../../src/zotero/nativeExport';
import type { StructureExport, StructureImageExport } from '../../src/viewer/StructureViewer';

const structure: StructureExport = {
  filename: '1crn.cif', mimeType: 'chemical/x-cif', text: 'data_1crn\n# café\n',
};
const image: StructureImageExport = {
  filename: '1crn.png', mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1sAAAAASUVORK5CYII=',
};

function fixture() {
  const parent = { closed: false } as Window;
  const picker = {
    modeSave: 1, returnOK: 0, returnReplace: 2, file: '/chosen/export.cif',
    defaultString: '', defaultExtension: '', addToRecentDocs: true,
    init: vi.fn(), appendFilter: vi.fn(), show: vi.fn(async () => 0),
  };
  const host = {
    createPicker: vi.fn(() => picker),
    encodeUTF8: (value: string) => new TextEncoder().encode(value),
    decodeBase64: (value: string) => atob(value),
    write: vi.fn<(path: string, data: Uint8Array, options: { mode: 'create' | 'overwrite' }) => Promise<void>>(async () => undefined),
  };
  return { parent, picker, host, actions: createZoteroExportActions(host, () => parent) };
}

describe('Zotero native exports', () => {
  it('writes exact UTF-8 mmCIF bytes only to the selected Save As path', async () => {
    const { parent, picker, host, actions } = fixture();
    await actions.saveStructure(structure);
    expect(picker.init).toHaveBeenCalledWith(parent, 'Save ProtPeek structure', picker.modeSave);
    expect(picker.defaultString).toBe('1crn.cif');
    expect(picker.defaultExtension).toBe('cif');
    expect(picker.addToRecentDocs).toBe(false);
    expect(picker.appendFilter).toHaveBeenCalledWith('PDBx/mmCIF structure', '*.cif');
    expect(host.write).toHaveBeenCalledWith('/chosen/export.cif', new TextEncoder().encode(structure.text), { mode: 'create' });
  });

  it('decodes PNG data locally and writes binary bytes rather than a data URL', async () => {
    const { picker, host, actions } = fixture();
    picker.file = '/chosen/view.png';
    await actions.saveImage(image);
    const [path, bytes, options] = host.write.mock.calls[0]!;
    expect(path).toBe('/chosen/view.png');
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(options).toEqual({ mode: 'create' });
    expect(picker.defaultExtension).toBe('png');
    expect(picker.appendFilter).toHaveBeenCalledWith('PNG image', '*.png');
  });

  it('allows overwrite only after the native picker returns confirmed replacement', async () => {
    const { picker, host, actions } = fixture();
    picker.show.mockResolvedValue(picker.returnReplace);
    await actions.saveStructure(structure);
    expect(host.write.mock.calls[0]?.[2]).toEqual({ mode: 'overwrite' });
  });

  it.each([1, -1, 99])('does not write after cancellation or an unknown picker result (%s)', async result => {
    const { picker, host, actions } = fixture();
    picker.show.mockResolvedValue(result);
    await actions.saveStructure(structure);
    expect(host.write).not.toHaveBeenCalled();
  });

  it.each(['../escape.cif', 'C:\\escape.cif', 'sub/file.cif', '.hidden.cif', 'model.png', 'bad\0.cif'])('rejects invalid suggested filenames before opening a native dialog (%s)', async filename => {
    const { host, actions } = fixture();
    await expect(actions.saveStructure({ ...structure, filename })).rejects.toThrow('filename');
    expect(host.createPicker).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
  });

  it('rejects unsupported MIME types, empty text and fake/nonlocal PNG payloads', async () => {
    const { host, actions } = fixture();
    await expect(actions.saveStructure({ ...structure, mimeType: 'text/html' } as unknown as StructureExport)).rejects.toThrow('PDBx/mmCIF');
    await expect(actions.saveStructure({ ...structure, text: '' })).rejects.toThrow('PDBx/mmCIF');
    await expect(actions.saveImage({ ...image, dataUrl: 'https://example.org/image.png' })).rejects.toThrow('PNG');
    await expect(actions.saveImage({ ...image, dataUrl: 'data:image/png;base64,SGVsbG8=' })).rejects.toThrow('PNG');
    await expect(actions.saveImage({ ...image, mimeType: 'image/jpeg' } as unknown as StructureImageExport)).rejects.toThrow('PNG');
    expect(host.createPicker).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
  });

  it('propagates disk failures without leaving the native export bridge locked', async () => {
    const { host, actions } = fixture();
    host.write.mockRejectedValueOnce(new Error('Disk full'));
    await expect(actions.saveStructure(structure)).rejects.toThrow('Disk full');
    await expect(actions.saveStructure(structure)).resolves.toBeUndefined();
    expect(host.write).toHaveBeenCalledTimes(2);
  });

  it('does not open concurrent save dialogs and becomes available after cancellation', async () => {
    const { picker, host, actions } = fixture();
    let finish: (result: number) => void = () => {};
    picker.show.mockImplementationOnce(() => new Promise<number>(resolve => { finish = resolve; }));
    const first = actions.saveStructure(structure);
    await expect(actions.saveImage(image)).rejects.toThrow('already open');
    expect(host.createPicker).toHaveBeenCalledOnce();
    finish(1);
    await first;
    await actions.saveStructure(structure);
    expect(host.createPicker).toHaveBeenCalledTimes(2);
    expect(host.write).toHaveBeenCalledOnce();
  });

  it('does not open a dialog or write when the parent viewer has closed', async () => {
    const { parent, host, actions } = fixture();
    Object.assign(parent, { closed: true });
    await expect(actions.saveStructure(structure)).rejects.toThrow('closed');
    expect(host.createPicker).not.toHaveBeenCalled();
    expect(host.write).not.toHaveBeenCalled();
  });
});
