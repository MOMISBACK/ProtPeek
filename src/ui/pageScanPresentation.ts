// SPDX-License-Identifier: MPL-2.0

export interface PageScanPresentation {
  readonly heading: string;
  readonly showResults: boolean;
  readonly status: string;
}

export function pageScanPresentation(
  detectedStructureCount: number | null,
  error?: string,
): PageScanPresentation {
  if (detectedStructureCount === null) {
    return {
      heading: '',
      showResults: false,
      status: 'Scanning this page…',
    };
  }

  if (error !== undefined) {
    return {
      heading: '',
      showResults: false,
      status: error,
    };
  }

  if (detectedStructureCount === 0) {
    return {
      heading: '',
      showResults: false,
      status: 'No structures found on this page.',
    };
  }

  return {
    heading: `${detectedStructureCount} ${detectedStructureCount === 1 ? 'STRUCTURE' : 'STRUCTURES'} FOUND`,
    showResults: true,
    status: '',
  };
}
