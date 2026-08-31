// SPDX-License-Identifier: MPL-2.0
import type { LoadedStructureData } from '../types';
import { fetchFirstAvailable } from './fetchStructure';

export function rcsbCandidates(id: string) {
  const encodedId = encodeURIComponent(id.toLowerCase());
  return [
    {
      format: 'mmcif' as const,
      isBinary: true,
      url: `https://models.rcsb.org/${encodedId}.bcif`,
    },
    {
      format: 'mmcif' as const,
      isBinary: false,
      url: `https://files.rcsb.org/download/${encodedId}.cif`,
    },
  ];
}

export async function loadRcsbStructure(
  id: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LoadedStructureData> {
  const result = await fetchFirstAvailable(rcsbCandidates(id), signal, fetcher);
  return {
    data: result.data,
    downloadMs: result.downloadMs,
    format: result.format,
    isBinary: result.isBinary,
    label: id.toUpperCase(),
    source: { kind: 'pdb', id },
  };
}
