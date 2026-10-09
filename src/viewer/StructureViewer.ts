// SPDX-License-Identifier: MPL-2.0
import type {
  LoadedStructureData,
  SelectedResidue,
  ViewerLoadResult,
} from '../structures/types';

export type StructureRepresentation = 'cartoon' | 'surface';

export type SelectionRepresentation =
  | 'highlight'
  | 'sticks'
  | 'ball-and-stick';

export type StructureColorMode = 'chain' | 'uniform' | 'residue-type';

export type ViewerBackground = 'white' | 'black';

export interface ResidueTarget {
  chainId?: string;
  insertionCode?: string;
  number: number;
}

export interface LigandTarget {
  chainId?: string;
  compId: string;
}

export interface ViewerSelection {
  chains?: string[];
  ligands?: LigandTarget[];
  residues?: ResidueTarget[];
}

export interface ViewerEvents {
  onContextLost?(): void;
  onContextRestored?(): void;
  onHover?(residue: SelectedResidue | null): void;
  onSelection?(residue: SelectedResidue | null): void;
}

export interface StructureExport {
  filename: string;
  mimeType: 'chemical/x-cif';
  text: string;
}

export interface StructureImageExport {
  dataUrl: string;
  filename: string;
  mimeType: 'image/png';
}

export interface StructureViewer {
  cancelCurrentTask(): void;
  clear(): Promise<void>;
  colorSelection(color: number | null): Promise<void>;
  dispose(): void;
  exportCurrentImage(): Promise<StructureImageExport>;
  exportCurrentStructure(): StructureExport;
  focusChain(chainId: string): void;
  focusSelection(): void;
  isolate(selection: ViewerSelection): Promise<void>;
  load(data: LoadedStructureData): Promise<ViewerLoadResult>;
  resetCamera(): void;
  resize(): void;
  select(selection: ViewerSelection): void;
  setChainVisible(chainId: string, visible: boolean): Promise<void>;
  setColorMode(mode: StructureColorMode): Promise<void>;
  setRepresentation(representation: StructureRepresentation): Promise<void>;
  setSelectionRepresentation(
    representation: SelectionRepresentation,
  ): Promise<void>;
  setBackground(background: ViewerBackground): void;
  showAll(): Promise<void>;
}
