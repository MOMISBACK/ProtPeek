// SPDX-License-Identifier: MPL-2.0
import type { LoadedStructureData } from '../types';
import { StructureLoadError, toStructureLoadError } from './errors';
import { fetchFirstAvailable } from './fetchStructure';

const ALPHAFOLD_ORIGIN = 'https://alphafold.ebi.ac.uk';

interface AlphaFoldPrediction {
  bcifUrl?: unknown;
  cifUrl?: unknown;
  entryId?: unknown;
  modelEntityId?: unknown;
  uniprotAccession?: unknown;
}

function uniprotFromInput(input: string): string {
  const normalized = input.trim().toUpperCase();
  const match = /^AF-([A-Z0-9]{6,10})-F\d+$/.exec(normalized);
  return match?.[1] ?? normalized;
}

function trustedDownloadUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    return url.origin === ALPHAFOLD_ORIGIN ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal: AbortSignal, cause?: unknown): void {
  if (!signal.aborted) return;

  throw new StructureLoadError(
    'aborted',
    'Loading was cancelled',
    cause === undefined ? undefined : { cause },
  );
}

export async function loadAlphaFoldStructure(
  input: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LoadedStructureData> {
  const uniprotId = uniprotFromInput(input);
  throwIfAborted(signal);

  let metadataResponse: Response;
  try {
    metadataResponse = await fetcher(
      `${ALPHAFOLD_ORIGIN}/api/prediction/${encodeURIComponent(uniprotId)}`,
      {
        credentials: 'omit',
        signal,
      },
    );
    throwIfAborted(signal);
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal, error);
    throw toStructureLoadError(error);
  }

  if (metadataResponse.status === 404) {
    throw new StructureLoadError('not-found', 'AlphaFold prediction not found');
  }
  if (!metadataResponse.ok) {
    throw new StructureLoadError('network', 'AlphaFold DB is unavailable');
  }

  let payload: unknown;
  try {
    payload = await metadataResponse.json();
    throwIfAborted(signal);
  } catch (error) {
    if (signal.aborted) throwIfAborted(signal, error);
    throw new StructureLoadError(
      'invalid-file',
      'AlphaFold returned invalid metadata',
      { cause: error },
    );
  }
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new StructureLoadError('not-found', 'AlphaFold prediction not found');
  }

  const requestedEntry = input.trim().toUpperCase();
  const predictions = payload.filter(
    (item): item is AlphaFoldPrediction =>
      typeof item === 'object' && item !== null,
  );
  const prediction =
    predictions.find((item) => {
      const id = item.entryId ?? item.modelEntityId;
      return typeof id === 'string' && id.toUpperCase() === requestedEntry;
    }) ?? predictions[0];

  if (prediction === undefined) {
    throw new StructureLoadError('invalid-file', 'AlphaFold returned invalid metadata');
  }

  const bcifUrl = trustedDownloadUrl(prediction.bcifUrl);
  const cifUrl = trustedDownloadUrl(prediction.cifUrl);
  const candidates = [
    ...(bcifUrl === undefined
      ? []
      : [{ format: 'mmcif' as const, isBinary: true, url: bcifUrl }]),
    ...(cifUrl === undefined
      ? []
      : [{ format: 'mmcif' as const, isBinary: false, url: cifUrl }]),
  ];

  if (candidates.length === 0) {
    throw new StructureLoadError('invalid-file', 'AlphaFold returned no structure file');
  }

  const result = await fetchFirstAvailable(candidates, signal, fetcher);
  const entryId =
    typeof prediction.entryId === 'string'
      ? prediction.entryId
      : `AF-${uniprotId}-F1`;

  return {
    data: result.data,
    downloadMs: result.downloadMs,
    format: result.format,
    isBinary: result.isBinary,
    label: entryId,
    source: { kind: 'alphafold', id: entryId },
  };
}
