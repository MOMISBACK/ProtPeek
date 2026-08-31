// SPDX-License-Identifier: MPL-2.0
import { StructureLoadError } from './errors';

const MAX_REMOTE_FILE_BYTES = 512 * 1024 * 1024;

export interface FetchCandidate {
  format: 'mmcif' | 'pdb';
  isBinary: boolean;
  url: string;
}

export interface FetchStructureResult extends FetchCandidate {
  data: string | Uint8Array<ArrayBuffer>;
  downloadMs: number;
}

function throwIfAborted(signal: AbortSignal, cause?: unknown): void {
  if (!signal.aborted) return;

  throw new StructureLoadError(
    'aborted',
    'Loading was cancelled',
    cause === undefined ? undefined : { cause },
  );
}

function rejectOversizedResponse(response: Response): void {
  const declaredLength = response.headers?.get('content-length');
  if (declaredLength === null || declaredLength === undefined) return;
  const bytes = Number(declaredLength);
  if (Number.isFinite(bytes) && bytes > MAX_REMOTE_FILE_BYTES) {
    throw new StructureLoadError(
      'file-too-large',
      'This structure is too large to open safely',
    );
  }
}

function rejectOversizedData(data: string | Uint8Array<ArrayBuffer>): void {
  const bytes = typeof data === 'string' ? new Blob([data]).size : data.byteLength;
  if (bytes > MAX_REMOTE_FILE_BYTES) {
    throw new StructureLoadError(
      'file-too-large',
      'This structure is too large to open safely',
    );
  }
}

export async function fetchFirstAvailable(
  candidates: readonly FetchCandidate[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<FetchStructureResult> {
  let lastStatus: number | undefined;
  let lastError: unknown;

  throwIfAborted(signal);

  for (const candidate of candidates) {
    throwIfAborted(signal);
    const startedAt = performance.now();
    try {
      const response = await fetcher(candidate.url, {
        cache: 'default',
        credentials: 'omit',
        redirect: 'follow',
        signal,
      });
      throwIfAborted(signal);
      lastStatus = response.status;
      if (!response.ok) {
        lastError = undefined;
        continue;
      }

      rejectOversizedResponse(response);

      const data = candidate.isBinary
        ? new Uint8Array(await response.arrayBuffer())
        : await response.text();
      throwIfAborted(signal);

      rejectOversizedData(data);

      if (data.length === 0) {
        throw new StructureLoadError('invalid-file', 'The structure file is empty');
      }

      return {
        ...candidate,
        data,
        downloadMs: performance.now() - startedAt,
      };
    } catch (error) {
      if (signal.aborted) throwIfAborted(signal, error);
      lastStatus = undefined;
      lastError = error;
    }
  }

  if (lastStatus === 404) {
    throw new StructureLoadError('not-found', 'Structure not found');
  }

  if (lastError instanceof StructureLoadError) throw lastError;

  throw new StructureLoadError('network', 'The structure service is unavailable', {
    cause: lastError,
  });
}
