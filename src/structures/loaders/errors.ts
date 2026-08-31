// SPDX-License-Identifier: MPL-2.0
export type StructureLoadErrorCode =
  | 'aborted'
  | 'file-too-large'
  | 'invalid-file'
  | 'network'
  | 'not-found'
  | 'unsupported-file'
  | 'webgl-unavailable';

export class StructureLoadError extends Error {
  constructor(
    readonly code: StructureLoadErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'StructureLoadError';
  }
}

export function toStructureLoadError(error: unknown): StructureLoadError {
  if (error instanceof StructureLoadError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new StructureLoadError('aborted', 'Loading was cancelled', {
      cause: error,
    });
  }
  return new StructureLoadError('network', 'The structure could not be loaded', {
    cause: error,
  });
}
