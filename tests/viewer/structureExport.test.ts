// SPDX-License-Identifier: MPL-2.0
import { describe, expect, it } from 'vitest';

import {
  structureExportBlockName,
  structureExportFilename,
} from '../../src/viewer/structureExport';
import type { LoadedStructureData } from '../../src/structures/types';

function loadedData(
  overrides: Partial<LoadedStructureData>,
): LoadedStructureData {
  return {
    data: '',
    format: 'mmcif',
    isBinary: false,
    label: 'fallback',
    source: { kind: 'local', name: 'fallback.cif' },
    ...overrides,
  };
}

describe('structureExportFilename', () => {
  it('uses an uppercase PDB identifier', () => {
    expect(structureExportFilename(loadedData({
      label: '1crn',
      source: { kind: 'pdb', id: '1crn' },
    }))).toBe('1CRN.cif');
  });

  it('preserves a useful local stem and replaces the original format', () => {
    expect(structureExportFilename(loadedData({
      label: 'My protein.final.pdb',
      source: { kind: 'local', name: 'My protein.final.pdb' },
    }))).toBe('My-protein.final.cif');
  });

  it('exports a local GRO structure with a CIF extension', () => {
    expect(structureExportFilename(loadedData({
      format: 'gro',
      source: { kind: 'local', name: 'simulation.GRO' },
    }))).toBe('simulation.cif');
  });

  it('removes paths, reserved characters, and bidi controls', () => {
    expect(structureExportFilename(loadedData({
      label: 'ignored',
      source: { kind: 'local', name: '../unsafe\\name\u202e:*?.bcif' },
    }))).toBe('name.cif');
  });

  it('avoids empty and Windows-reserved filenames', () => {
    expect(structureExportFilename(loadedData({
      source: { kind: 'local', name: '.pdb' },
    }))).toBe('structure.cif');
    expect(structureExportFilename(loadedData({
      source: { kind: 'local', name: 'CON.pdb' },
    }))).toBe('structure-CON.cif');
  });
});

describe('structureExportBlockName', () => {
  it('creates an ASCII-safe mmCIF data block name', () => {
    expect(structureExportBlockName('Protéine β.cif')).toBe('Proteine');
    expect(structureExportBlockName('中文.cif')).toBe('structure');
  });
});
