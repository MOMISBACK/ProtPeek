// SPDX-License-Identifier: MPL-2.0
import type { StructureExport, StructureImageExport } from '../viewer/StructureViewer';

/** The Zotero 7+ filePicker.mjs wrapper returns paths, not nsIFile objects. */
export interface ZoteroFilePicker {
  readonly modeSave: number;
  readonly returnOK: number;
  readonly returnReplace: number;
  readonly file: string;
  defaultString: string;
  defaultExtension: string;
  addToRecentDocs: boolean;
  init(parent: Window, title: string, mode: number): void;
  appendFilter(title: string, pattern: string): void;
  show(): Promise<number>;
}

export interface ZoteroExportHost {
  createPicker(): ZoteroFilePicker;
  decodeBase64(value: string): string;
  encodeUTF8(value: string): Uint8Array;
  write(path: string, data: Uint8Array, options: { mode: 'create' | 'overwrite' }): Promise<unknown>;
}

const MAX_STRUCTURE_BYTES = 256 * 1024 * 1024;
const MAX_PNG_BYTES = 64 * 1024 * 1024;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function requireFilename(value: unknown, extension: 'cif' | 'png'): string {
  if (typeof value !== 'string' || value.length > 180
    || !value || value.startsWith('.')
    || /[\\/:*?"<>|]/.test(value)
    || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    || !value.toLowerCase().endsWith(`.${extension}`)) {
    throw new Error(`Invalid ${extension.toUpperCase()} export filename.`);
  }
  return value;
}

/** Narrow, user-initiated export bridge. A path can only come from Save As. */
export function createZoteroExportActions(
  host: ZoteroExportHost,
  getParent: () => Window,
): {
  saveStructure(exported: StructureExport): Promise<void>;
  saveImage(exported: StructureImageExport): Promise<void>;
} {
  let busy = false;

  async function save(
    filename: string,
    extension: 'cif' | 'png',
    data: Uint8Array,
  ): Promise<void> {
    if (busy) throw new Error('A ProtPeek save dialog is already open.');
    busy = true;
    try {
      const parent = getParent();
      if (parent.closed) throw new Error('The ProtPeek viewer has been closed.');
      const picker = host.createPicker();
      picker.init(parent, extension === 'png' ? 'Save ProtPeek image' : 'Save ProtPeek structure', picker.modeSave);
      picker.defaultString = filename;
      picker.defaultExtension = extension;
      picker.addToRecentDocs = false;
      picker.appendFilter(extension === 'png' ? 'PNG image' : 'PDBx/mmCIF structure', `*.${extension}`);
      const result = await picker.show();
      if (result !== picker.returnOK && result !== picker.returnReplace) return;
      const path = picker.file;
      if (typeof path !== 'string' || !path || path.includes('\0')) {
        throw new Error('The save dialog did not provide a file path.');
      }
      // Overwrite only after the platform Save As dialog confirmed replacement.
      // If a file appears between choosing a new path and writing, fail safely.
      await host.write(path, data, { mode: result === picker.returnReplace ? 'overwrite' : 'create' });
    } finally {
      busy = false;
    }
  }

  return {
    async saveStructure(exported): Promise<void> {
      const filename = requireFilename(exported?.filename, 'cif');
      if (exported?.mimeType !== 'chemical/x-cif' || typeof exported.text !== 'string'
        || !exported.text.trim() || exported.text.length > MAX_STRUCTURE_BYTES) {
        throw new Error('Invalid PDBx/mmCIF export.');
      }
      const data = host.encodeUTF8(exported.text);
      if (data.byteLength > MAX_STRUCTURE_BYTES) throw new Error('The structure export is too large.');
      await save(filename, 'cif', data);
    },

    async saveImage(exported): Promise<void> {
      const filename = requireFilename(exported?.filename, 'png');
      if (exported?.mimeType !== 'image/png' || typeof exported.dataUrl !== 'string') {
        throw new Error('Invalid PNG image export.');
      }
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(exported.dataUrl);
      if (match?.[1] === undefined || match[1].length > Math.ceil(MAX_PNG_BYTES / 3) * 4) {
        throw new Error('Invalid or oversized PNG image export.');
      }
      let binary: string;
      try { binary = host.decodeBase64(match[1]); }
      catch { throw new Error('Invalid PNG image encoding.'); }
      const data = Uint8Array.from(binary, char => char.charCodeAt(0));
      if (data.byteLength > MAX_PNG_BYTES || !PNG_SIGNATURE.every((byte, i) => data[i] === byte)) {
        throw new Error('Invalid PNG image data.');
      }
      await save(filename, 'png', data);
    },
  };
}
