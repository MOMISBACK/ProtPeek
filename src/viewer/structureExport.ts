// SPDX-License-Identifier: MPL-2.0
import type { LoadedStructureData } from '../structures/types';

const STRUCTURE_EXTENSION = /\.(?:bcif|cif|mmcif|pdb|gro)$/iu;
const RESERVED_WINDOWS_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const MAX_STEM_CODE_POINTS = 96;

function preferredExportName(data: LoadedStructureData): string {
  switch (data.source.kind) {
    case 'local':
      return data.source.name || data.label;
    case 'pdb':
    case 'alphafold':
      return data.source.id.toUpperCase() || data.label;
  }
}

function stripControlCharacters(value: string): string {
  return [...value].filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
  }).join('');
}

function safeStem(value: string): string {
  const leaf = value.split(/[\\/]/u).at(-1) ?? '';
  const withoutExtension = leaf.trim().replace(STRUCTURE_EXTENSION, '');
  const normalized = stripControlCharacters(withoutExtension)
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u202a-\u202e\u2066-\u2069]/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[._-]+|[._-]+$/gu, '');
  const truncated = [...normalized].slice(0, MAX_STEM_CODE_POINTS).join('')
    .replace(/[._-]+$/gu, '');
  if (truncated.length === 0) return 'structure';
  return RESERVED_WINDOWS_NAME.test(truncated)
    ? `structure-${truncated}`
    : truncated;
}

export function structureExportFilename(data: LoadedStructureData): string {
  return `${safeStem(preferredExportName(data))}.cif`;
}

export function structureExportBlockName(filename: string): string {
  const stem = filename.replace(/\.cif$/iu, '');
  const blockName = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-zA-Z0-9_-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return blockName || 'structure';
}
