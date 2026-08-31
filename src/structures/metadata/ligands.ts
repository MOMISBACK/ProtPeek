// SPDX-License-Identifier: MPL-2.0
import type { LigandInfo, LigandKind } from '../types';

const WATER_COMPONENTS = new Set(['DOD', 'H2O', 'HOH', 'OH2', 'WAT']);
const COMMON_COFACTORS = new Set([
  'ADP',
  'ATP',
  'COA',
  'FAD',
  'FMN',
  'HEM',
  'NAD',
  'NAP',
  'SAM',
  'SF4',
]);

export interface NonPolymerInstance {
  atomCount: number;
  chainId: string;
  compId: string;
  instanceId: string;
  isPolymer: boolean;
  name?: string;
}

export function isWaterComponent(compId: string): boolean {
  return WATER_COMPONENTS.has(compId.toUpperCase());
}

function ligandKind(instance: NonPolymerInstance): LigandKind {
  if (instance.atomCount <= 1) return 'ion';
  return COMMON_COFACTORS.has(instance.compId.toUpperCase())
    ? 'cofactor'
    : 'organic';
}

export function aggregateLigands(
  instances: readonly NonPolymerInstance[],
): LigandInfo[] {
  const uniqueInstances = new Map<string, NonPolymerInstance>();
  for (const instance of instances) {
    if (instance.isPolymer || isWaterComponent(instance.compId)) continue;
    uniqueInstances.set(instance.instanceId, instance);
  }

  const groups = new Map<
    string,
    { chainIds: Set<string>; count: number; kind: LigandKind; name?: string }
  >();

  for (const instance of uniqueInstances.values()) {
    const compId = instance.compId.toUpperCase();
    const current = groups.get(compId) ?? {
      chainIds: new Set<string>(),
      count: 0,
      kind: ligandKind(instance),
    };
    current.chainIds.add(instance.chainId);
    current.count += 1;
    if (instance.name !== undefined) current.name = instance.name;
    groups.set(compId, current);
  }

  return [...groups.entries()]
    .map(([compId, group]) => ({
      chainIds: [...group.chainIds].sort(),
      compId,
      count: group.count,
      kind: group.kind,
      ...(group.name === undefined ? {} : { name: group.name }),
    }))
    .sort((a, b) => a.compId.localeCompare(b.compId));
}
