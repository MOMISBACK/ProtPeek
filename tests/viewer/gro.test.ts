// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';

import { parseGRO } from 'molstar/lib/mol-io/reader/gro/parser.js';
import { Structure } from 'molstar/lib/mol-model/structure.js';
import { trajectoryFromGRO } from 'molstar/lib/mol-model-formats/structure/gro.js';
import { Task } from 'molstar/lib/mol-task/index.js';
import { describe, expect, it } from 'vitest';

import { extractMolstarMetadata } from '../../src/viewer/molstarMetadata';

const source = await readFile(
  new URL('../fixtures/minimal-two-frame.gro', import.meta.url),
  'utf8',
);

// Mol* 5.11's package omits the gro/schema.d.ts referenced by parseGRO.
// Type the properties asserted below until that upstream declaration is shipped.
interface ParsedGro {
  structures: Array<{
    header: { timeInPs: number; hasVelocities: boolean };
    atoms: { vy: { value(row: number): number } };
  }>;
}

async function parseTrajectory(text = source) {
  const parsed = await parseGRO(text).run();
  if (parsed.isError) throw new Error(parsed.message);
  const gro = parsed.result as ParsedGro;
  return {
    parsed: gro,
    trajectory: await trajectoryFromGRO(gro).run(),
  };
}

describe('GRO model integration', () => {
  it('converts nanometres to angstroms exactly once', async () => {
    const { trajectory } = await parseTrajectory();
    const { x, y, z } = trajectory.representative.atomicConformation;

    expect(x).toHaveLength(16);
    expect([x[0], y[0], z[0]]).toEqual([10, 20, 30]);
    expect(x[1]).toBeCloseTo(11.45, 5);
    expect(y[3]).toBeCloseTo(22.45, 5);
  });

  it('keeps concatenated frames separate with the first frame as representative', async () => {
    const { parsed, trajectory } = await parseTrajectory();
    expect(parsed.structures.map(({ header }) => header.timeInPs)).toEqual([0, 10]);
    expect(trajectory.frameCount).toBe(2);
    expect(trajectory.representative.modelNum).toBe(1);
    expect(trajectory.representative.atomicConformation.z[0]).toBe(30);
    const second = await Task.resolveInContext(trajectory.getFrameAtIndex(1));
    expect(second.modelNum).toBe(2);
    expect(second.atomicConformation.z[0]).toBe(32.5);
  });

  it('maps observed residue names and author numbering to a usable inferred chain', async () => {
    const { trajectory } = await parseTrajectory();
    const metadata = extractMolstarMetadata(Structure.ofModel(trajectory.representative), {
      kind: 'local',
      name: 'minimal-two-frame.gro',
    });

    expect(metadata.atomCount).toBe(16);
    expect(metadata.chains).toHaveLength(1);
    expect(metadata.chains[0]?.authId).toBe('A');
    expect(metadata.chains[0]?.residues.map(({ code }) => code).join('')).toBe('AGVK');
    expect(metadata.chains[0]?.residues.map(({ authNumber }) => authNumber)).toEqual([41, 42, 43, 44]);
    expect(metadata.chains[0]?.residues.every(({ isObserved }) => isObserved)).toBe(true);
  });

  it('accepts optional velocities without altering structural coordinates', async () => {
    const text = source.split('\n').map((line) => (
      line.length === 44
        ? `${line}  0.0123 -0.0456  0.0789`
        : line
    )).join('\n');
    const { parsed, trajectory } = await parseTrajectory(text);

    expect(parsed.structures[0]?.header.hasVelocities).toBe(true);
    expect(parsed.structures[0]?.atoms.vy.value(0)).toBeCloseTo(-0.0456);
    const { x, y, z } = trajectory.representative.atomicConformation;
    expect([x[0], y[0], z[0]]).toEqual([10, 20, 30]);
  });

  it('infers a chain break from a residue-number discontinuity', async () => {
    const text = source.replace(/^ {3}43VAL/gm, '   51VAL').replace(/^ {3}44LYS/gm, '   52LYS');
    const { trajectory } = await parseTrajectory(text);
    const metadata = extractMolstarMetadata(Structure.ofModel(trajectory.representative), {
      kind: 'local',
      name: 'inferred-chains.gro',
    });

    expect(metadata.chains.map(({ authId }) => authId)).toEqual(['A', 'B']);
    expect(metadata.chains.map(({ residues }) => residues.map(({ code }) => code).join(''))).toEqual(['AG', 'VK']);
  });
});
