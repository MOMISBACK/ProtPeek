// SPDX-License-Identifier: MPL-2.0
import { cpus, platform, release } from 'node:os';

import { ArticleStructureScanner } from '../src/article/ArticleStructureScanner';
import { mapStructureSequence } from '../src/sequence/residueMapping';
import { parseResidueSelection } from '../src/sequence/residueSelectionParser';
import { parseStructureIdentifier } from '../src/structures/identifiers';

interface Result {
  iterations: number;
  medianMs: number;
  name: string;
  operationsPerSecond: number;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function measure(name: string, iterations: number, operation: () => void): Result {
  for (let index = 0; index < Math.min(iterations, 100); index += 1) operation();
  const samples: number[] = [];
  for (let run = 0; run < 7; run += 1) {
    const startedAt = performance.now();
    for (let index = 0; index < iterations; index += 1) operation();
    samples.push(performance.now() - startedAt);
  }
  const medianMs = median(samples);
  return {
    iterations,
    medianMs: Number(medianMs.toFixed(3)),
    name,
    operationsPerSecond: Number(((iterations / medianMs) * 1_000).toFixed(1)),
  };
}

const articleText = Array.from(
  { length: 650 },
  (_, index) =>
    index % 130 === 0
      ? `The coordinates were deposited as PDB: ${index % 260 === 0 ? '8XYZ' : '7ABC'}.`
      : `Scientific paragraph ${index} reports protein measurements at 280 nm.`,
).join(' ');
const scanner = new ArticleStructureScanner();

const canonical = Array.from({ length: 5_000 }, (_, index) => ({
  code: 'A',
  compId: 'ALA',
  labelNumber: index + 1,
}));
const observed = canonical
  .filter((_, index) => index % 9 !== 0)
  .map((residue, index) => ({
    authNumber: index + 17,
    chainId: 'A',
    code: residue.code,
    compId: residue.compId,
    insertionCode: index === 200 ? 'A' : '',
    labelNumber: residue.labelNumber,
  }));

const heapBefore = process.memoryUsage().heapUsed;
const results = [
  measure('identifier detection', 25_000, () => {
    parseStructureIdentifier('pdb_00001abc');
    parseStructureIdentifier('AF-P69905-F1');
  }),
  measure('residue expression', 12_000, () => {
    parseResidueSelection('A:254,278,281,300-340');
  }),
  measure('article scan (~42 KiB)', 80, () => {
    scanner.scan({
      text: articleText,
      url: 'https://example.org/article/structure-study',
      links: [{ href: 'https://www.rcsb.org/structure/8XYZ', text: '8XYZ' }],
    });
  }),
  measure('sequence map (5,000 residues)', 30, () => {
    mapStructureSequence('A', canonical, observed);
  }),
];
const heapAfter = process.memoryUsage().heapUsed;

console.log('ProtPeek deterministic CPU microbenchmarks');
console.log(
  JSON.stringify(
    {
      cpu: cpus()[0]?.model ?? 'unknown',
      node: process.version,
      os: `${platform()} ${release()}`,
    },
    null,
    2,
  ),
);
console.table(results);
console.log(
  `Observed Node heap delta: ${((heapAfter - heapBefore) / 1_048_576).toFixed(2)} MiB ` +
    '(not a browser/GPU memory measurement)',
);
