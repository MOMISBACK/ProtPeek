// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';

import { CIF } from 'molstar/lib/mol-io/reader/cif.js';
import {
  Structure,
  StructureElement,
  StructureProperties,
} from 'molstar/lib/mol-model/structure.js';
import { trajectoryFromMmCIF } from 'molstar/lib/mol-model-formats/structure/mmcif.js';
import 'molstar/lib/mol-script/runtime/query/compiler.js';
import { describe, expect, it } from 'vitest';

import type { ViewerSelection } from '../../src/viewer/StructureViewer';
import { extractMolstarMetadata } from '../../src/viewer/molstarMetadata';
import { schemaForSelection } from '../../src/viewer/molstarSelection';

async function fixtureSource(): Promise<string> {
  return readFile(new URL('../fixtures/minimal.cif', import.meta.url), 'utf8');
}

async function parseStructure(source: string): Promise<Structure> {
  const parsed = await CIF.parse(source).run();
  if (parsed.isError) throw new Error(parsed.toString());
  const block = parsed.result.blocks[0];
  if (block === undefined) throw new Error('Missing mmCIF block');
  const trajectory = await trajectoryFromMmCIF(block).run();
  return Structure.ofModel(trajectory.representative);
}

function selectedResidues(structure: Structure, selection: ViewerSelection): string[] {
  const loci = StructureElement.Schema.toLoci(
    structure,
    schemaForSelection(selection, structure),
  );
  const residues = new Set<string>();
  StructureElement.Loci.forEachLocation(loci, (location) => {
    const chain = StructureProperties.chain.auth_asym_id(location) ||
      StructureProperties.chain.label_asym_id(location);
    residues.add(
      `${chain}:${StructureProperties.residue.auth_seq_id(location)}` +
      StructureProperties.residue.pdbx_PDB_ins_code(location) +
      `:${StructureProperties.residue.label_comp_id(location)}`,
    );
  });
  return [...residues].sort();
}

async function crossedPolymerChains(): Promise<Structure> {
  const source = (await fixtureSource()).split('\n').flatMap((line) => {
    if (!line.startsWith('ATOM ')) return [line];
    const first = line.split(/\s+/u);
    const second = [...first];
    first[18] = 'B'; // label A, author B
    second[1] = String(Number(second[1]) + 6);
    second[6] = 'B'; // label B, author A
    return [first.join(' '), second.join(' ')];
  }).join('\n');
  // Relocate the original ligand to C so label B belongs to the second polymer.
  return parseStructure(source
    .replace('A 1\nB 2', 'A 1\nB 1\nC 2')
    .replace('ATP B 2', 'ATP C 2')
    .replace('101 ATP B P', '101 ATP C P'));
}

describe('Molstar selection schemas', () => {
  it('selects whole chains by author ID when author and label IDs cross', async () => {
    const structure = await crossedPolymerChains();
    expect(selectedResidues(structure, { chains: ['A'] })).toEqual([
      'A:5:ALA', 'A:6A:GLY',
    ]);
    expect(selectedResidues(structure, { chains: ['B'] })).toEqual([
      'B:5:ALA', 'B:6A:GLY',
    ]);
  });

  it('keeps residue selections on the requested author chain', async () => {
    const structure = await crossedPolymerChains();
    expect(selectedResidues(structure, {
      residues: [{ chainId: 'A', number: 5 }],
    })).toEqual(['A:5:ALA']);
    expect(selectedResidues(structure, {
      residues: [{ number: 5 }],
    })).toEqual(['A:5:ALA', 'B:5:ALA']);
  });

  it('distinguishes a plain residue from its insertion-coded neighbour', async () => {
    const source = (await fixtureSource()).replace(/\? 5 ALA/gu, '? 6 ALA');
    const structure = await parseStructure(source);
    expect(selectedResidues(structure, {
      residues: [{ chainId: 'A', number: 6 }],
    })).toEqual(['A:6:ALA']);
    expect(selectedResidues(structure, {
      residues: [{ chainId: 'A', number: 6, insertionCode: 'A' }],
    })).toEqual(['A:6A:GLY']);
    expect(selectedResidues(structure, { chains: ['A'] })).toEqual([
      'A:6:ALA', 'A:6A:GLY',
    ]);
  });

  it('uses label IDs only for chains whose author ID is missing', async () => {
    const source = (await fixtureSource()).split('\n').map((line) => {
      if (!line.startsWith('ATOM ')) return line;
      const fields = line.split(/\s+/u);
      fields[18] = '?';
      return fields.join(' ');
    }).join('\n');
    const structure = await parseStructure(source);
    const chain = extractMolstarMetadata(structure, {
      kind: 'local', name: 'missing-author.cif',
    }).chains[0];
    expect(chain?.authId).toBe('A');
    const loci = StructureElement.Schema.toLoci(
      structure,
      schemaForSelection({ chains: [chain!.authId] }, structure),
    );
    expect(StructureElement.Loci.size(loci)).toBe(5);
  });

  it('selects ligands on their author chain without matching crossed labels', async () => {
    const source = (await fixtureSource()).split('\n').flatMap((line) => {
      if (line.startsWith('ATOM ')) {
        const fields = line.split(/\s+/u);
        fields[6] = 'P';
        fields[18] = 'P';
        return [fields.join(' ')];
      }
      if (!line.startsWith('HETATM ')) return [line];
      const first = line.split(/\s+/u);
      const second = [...first];
      first[6] = 'A'; // label A, author B
      second[1] = '7';
      second[18] = 'A'; // label B, author A
      return [first.join(' '), second.join(' ')];
    }).join('\n').replace('A 1\nB 2', 'P 1\nA 2\nB 2');
    const structure = await parseStructure(source);
    expect(selectedResidues(structure, {
      ligands: [{ chainId: 'A', compId: 'atp' }],
    })).toEqual(['A:101:ATP']);
    expect(selectedResidues(structure, {
      ligands: [{ compId: 'ATP' }],
    })).toEqual(['A:101:ATP', 'B:101:ATP']);
  });

  it('does not broaden an unknown chain to the entire structure', async () => {
    const structure = await parseStructure(await fixtureSource());
    expect(selectedResidues(structure, { chains: ['missing'] })).toEqual([]);
    expect(selectedResidues(structure, {})).toEqual([]);
  });
});
