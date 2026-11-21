// SPDX-License-Identifier: MPL-2.0
import { parseStructureIdentifier } from '../structures/identifiers';

export interface RecentStructure { identifier: string; label: string; openedAt: number; }
const KEY = 'protpeek:android:recent:v1';

/** Metadata only: a recent entry does not mean its coordinate file is cached. */
export function recentStructures(): RecentStructure[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is RecentStructure => {
      if (typeof item !== 'object' || item === null) return false;
      const row = item as Partial<RecentStructure>;
      return typeof row.identifier === 'string' && parseStructureIdentifier(row.identifier) !== null &&
        typeof row.label === 'string' && typeof row.openedAt === 'number' && Number.isFinite(row.openedAt);
    }).slice(0, 8);
  } catch { return []; }
}

export function rememberStructure(identifier: string, label: string): void {
  const values = recentStructures().filter(item => item.identifier.toUpperCase() !== identifier.toUpperCase());
  values.unshift({ identifier, label, openedAt: Date.now() });
  try { localStorage.setItem(KEY, JSON.stringify(values.slice(0, 8))); } catch { /* Viewing still works when preferences cannot be saved. */ }
}
