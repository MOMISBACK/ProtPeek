// SPDX-License-Identifier: MPL-2.0
export type StructureFormat = 'mmcif' | 'pdb';

export type StructureSource =
  | { kind: 'local'; name: string }
  | { kind: 'pdb'; id: string }
  | { kind: 'alphafold'; id: string };

export interface LoadTimings {
  acquisitionMs?: number;
  downloadMs?: number;
  parseMs?: number;
  structureMs?: number;
  renderMs?: number;
  firstFrameMs?: number;
  totalMs: number;
}

export interface LoadedStructureData {
  data: string | Uint8Array<ArrayBuffer>;
  format: StructureFormat;
  isBinary: boolean;
  label: string;
  source: StructureSource;
  downloadMs?: number;
}

export interface ResidueInfo {
  authNumber?: number;
  chainId: string;
  code: string;
  compId: string;
  insertionCode: string;
  isObserved: boolean;
  labelNumber?: number;
}

export interface ChainInfo {
  authId: string;
  entityDescription: string;
  entityId: string;
  labelId: string;
  polymerType: string;
  residues: ResidueInfo[];
}

export type LigandKind = 'cofactor' | 'ion' | 'organic';

export interface LigandInfo {
  chainIds: string[];
  compId: string;
  count: number;
  kind: LigandKind;
  name?: string;
}

export interface StructureMetadata {
  atomCount: number;
  chains: ChainInfo[];
  ligands: LigandInfo[];
  source: StructureSource;
}

export interface SelectedResidue {
  chainId: string;
  compId: string;
  insertionCode: string;
  number: number;
}

export interface ViewerLoadResult {
  metadata: StructureMetadata;
  timings: LoadTimings;
}
