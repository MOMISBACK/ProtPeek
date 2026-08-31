// SPDX-License-Identifier: MPL-2.0
import type { LoadedStructureData, StructureFormat } from '../types';
import { StructureLoadError } from './errors';

const MAX_LOCAL_FILE_BYTES = 512 * 1024 * 1024;
const EXTENSION_PATTERN = /\.(bcif|cif|mmcif|pdb)$/i;

export function localFileFormat(name: string): {
  format: StructureFormat;
  isBinary: boolean;
} | null {
  const extension = EXTENSION_PATTERN.exec(name)?.[1]?.toLowerCase();
  if (extension === undefined) return null;
  if (extension === 'pdb') return { format: 'pdb', isBinary: false };
  return { format: 'mmcif', isBinary: extension === 'bcif' };
}

export async function loadLocalStructure(
  file: File,
  signal: AbortSignal,
): Promise<LoadedStructureData> {
  const info = localFileFormat(file.name);
  if (info === null) {
    throw new StructureLoadError('unsupported-file', 'Unsupported structure file');
  }
  if (file.size === 0) {
    throw new StructureLoadError('invalid-file', 'The structure file is empty');
  }
  if (file.size > MAX_LOCAL_FILE_BYTES) {
    throw new StructureLoadError(
      'file-too-large',
      'This structure is too large to open safely',
    );
  }
  if (signal.aborted) {
    throw new StructureLoadError('aborted', 'Loading was cancelled');
  }

  const data = info.isBinary
    ? new Uint8Array(await file.arrayBuffer())
    : await file.text();

  if (signal.aborted) {
    throw new StructureLoadError('aborted', 'Loading was cancelled');
  }

  return {
    data,
    format: info.format,
    isBinary: info.isBinary,
    label: file.name,
    source: { kind: 'local', name: file.name },
  };
}
