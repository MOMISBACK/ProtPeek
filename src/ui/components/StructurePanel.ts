// SPDX-License-Identifier: MPL-2.0
import { parseResidueSelection } from '../../sequence/residueSelectionParser';
import { resolveResidueSelection } from '../../sequence/resolveResidueSelection';
import type {
  ChainInfo,
  ResidueInfo,
  SelectedResidue,
  StructureMetadata,
} from '../../structures/types';
import type {
  SelectionRepresentation,
  StructureColorMode,
  StructureRepresentation,
  ViewerSelection,
  ViewerBackground,
} from '../../viewer/StructureViewer';
import { button, element, SELECT_VALUE_CHANGED, setHidden } from './dom';
import { VirtualSequence } from './VirtualSequence';

export interface StructurePanelCallbacks {
  onBackground: (background: ViewerBackground) => void;
  onChainVisible: (chainId: string, visible: boolean) => Promise<boolean>;
  onColorMode: (mode: StructureColorMode) => Promise<boolean>;
  onColorSelection: (color: number | null) => Promise<boolean>;
  onFocusSelection: () => void;
  onIsolate: (selection: ViewerSelection) => Promise<boolean>;
  onRepresentation: (
    representation: StructureRepresentation,
  ) => Promise<boolean>;
  onResetView: () => void;
  onSelect: (selection: ViewerSelection, focus: boolean) => void;
  onSelectionRepresentation: (
    representation: SelectionRepresentation,
  ) => Promise<boolean>;
  onShowAll: () => Promise<boolean>;
}

export class StructurePanel {
  readonly entityStrip = element('section', { className: 'entity-strip' });
  readonly inspector = element('section', { className: 'inspector' });
  readonly #callbacks: StructurePanelCallbacks;
  readonly #chainList = element('div', { className: 'entity-group chain-list' });
  readonly #ligandList = element('div', { className: 'entity-group ligand-list' });
  readonly #sequence = new VirtualSequence({
    onResidueClick: (residue) => this.#selectResidue(residue),
  });
  readonly #sequenceTitle = element('h2', {
    className: 'section-label',
    text: 'Sequence',
  });
  readonly #representationSelect = element('select', {
    className: 'compact-select',
  });
  readonly #colorSelect = element('select', { className: 'compact-select' });
  readonly #selectionRepresentationSelect = element('select', {
    className: 'compact-select selection-representation',
  });
  readonly #selectionInput = element('input', { className: 'selection-input' });
  readonly #selectionError = element('p', { className: 'field-error' });
  readonly #customizationPanel = element('details', {
    className: 'customization-panel',
  });
  readonly #colorSwatches = new Map<number, HTMLButtonElement>();
  readonly #backgroundChoices = new Map<ViewerBackground, HTMLButtonElement>();
  readonly #selectedLabel = element('span', {
    className: 'selected-label',
    text: 'No selection',
  });
  readonly #focusButton = button('Focus', { className: 'text-button' });
  readonly #isolateButton = button('Isolate', { className: 'text-button' });
  readonly #showAllButton = button('Show all', { className: 'text-button' });
  #metadata: StructureMetadata | undefined;
  #colorMode: StructureColorMode = 'chain';
  readonly #hiddenChains = new Set<string>();
  #focusActive = false;
  #hasSelectionColors = false;
  #isolateActive = false;
  #modified = false;
  #representation: StructureRepresentation = 'cartoon';
  #representationRequest = 0;
  #selectedChain = '';
  #selectionColor: number | null = null;
  #selectionRepresentation: SelectionRepresentation = 'highlight';
  #selectionRepresentationRequest = 0;
  #colorModeRequest = 0;
  #selection: ViewerSelection = {};

  constructor(callbacks: StructurePanelCallbacks) {
    this.#callbacks = callbacks;
    this.#selectionInput.type = 'text';
    this.#selectionInput.placeholder = 'A:254,278 or A:254-281';
    this.#selectionInput.autocomplete = 'off';
    this.#selectionInput.spellcheck = false;
    this.#selectionInput.setAttribute('aria-label', 'Residue selection');
    this.#selectionInput.setAttribute('aria-describedby', 'selection-error');
    this.#selectionError.id = 'selection-error';
    this.#selectionError.setAttribute('aria-live', 'polite');
    this.#selectedLabel.setAttribute('aria-live', 'polite');

    this.#buildEntityStrip();
    this.#buildInspector();
    this.#syncModified();
    this.#syncSelectionActions();
    setHidden(this.entityStrip, true);
    setHidden(this.inspector, true);
  }

  setMetadata(metadata: StructureMetadata): void {
    this.#metadata = metadata;
    this.#hiddenChains.clear();
    this.#focusActive = false;
    this.#hasSelectionColors = false;
    this.#isolateActive = false;
    this.#modified = false;
    this.#representation = 'cartoon';
    this.#colorMode = 'chain';
    this.#selection = {};
    this.#selectionColor = null;
    this.#selectionRepresentation = 'highlight';
    this.#selectedChain = metadata.chains[0]?.authId ?? '';
    this.#renderEntities();
    this.#renderSequence();
    this.#selectedLabel.textContent = 'No selection';
    this.#setSelectValue(this.#representationSelect, 'cartoon');
    this.#setSelectValue(this.#colorSelect, 'chain');
    this.#setSelectValue(this.#selectionRepresentationSelect, 'highlight');
    this.#selectionInput.value = '';
    this.#selectionError.textContent = '';
    this.#customizationPanel.open = false;
    this.#syncModified();
    this.#syncColorSwatches();
    this.#syncSelectionActions();
    setHidden(this.entityStrip, false);
    setHidden(this.inspector, false);
  }

  clear(): void {
    this.#metadata = undefined;
    this.#hiddenChains.clear();
    this.#focusActive = false;
    this.#hasSelectionColors = false;
    this.#isolateActive = false;
    this.#modified = false;
    this.#representation = 'cartoon';
    this.#colorMode = 'chain';
    this.#selectedChain = '';
    this.#selection = {};
    this.#selectionColor = null;
    this.#selectionRepresentation = 'highlight';
    this.#chainList.replaceChildren();
    this.#ligandList.replaceChildren();
    this.#sequence.setSequence('', []);
    this.#selectedLabel.textContent = 'No selection';
    this.#setSelectValue(this.#representationSelect, 'cartoon');
    this.#setSelectValue(this.#colorSelect, 'chain');
    this.#setSelectValue(this.#selectionRepresentationSelect, 'highlight');
    this.#selectionInput.value = '';
    this.#selectionError.textContent = '';
    this.#customizationPanel.open = false;
    this.#syncModified();
    this.#syncColorSwatches();
    this.#syncSelectionActions();
    setHidden(this.entityStrip, true);
    setHidden(this.inspector, true);
  }

  setModified(modified: boolean): void {
    this.#modified = modified;
    if (!modified) {
      this.#focusActive = false;
      this.#hasSelectionColors = false;
      this.#hiddenChains.clear();
      this.#isolateActive = false;
      this.#selectionColor = null;
      this.#renderEntities();
      this.#syncColorSwatches();
    }
    this.#syncModified();
    this.#syncSelectionActions();
  }

  resetViewState(): void {
    this.#focusActive = false;
    this.#syncSelectionActions();
  }

  setBusy(busy: boolean): void {
    for (const section of [this.entityStrip, this.inspector]) {
      section.inert = busy;
      section.classList.toggle('is-busy', busy);
      section.setAttribute('aria-busy', String(busy));
    }
  }

  highlightResidue(residue: SelectedResidue | null): void {
    this.#sequence.select(residue);
    if (residue === null) {
      this.#resetSelectionFocus(false);
      this.#selection = {};
      this.#selectionColor = null;
      this.#selectedLabel.textContent = 'No selection';
      this.#resetSelectionRepresentation();
      this.#syncColorSwatches();
      this.#syncSelectionActions();
      return;
    }

    const chain = this.#metadata?.chains.find(
      (candidate) => candidate.authId === residue.chainId,
    );
    if (chain !== undefined && chain.authId !== this.#selectedChain) {
      this.#selectedChain = chain.authId;
      this.#renderEntities();
      this.#renderSequence();
      this.#sequence.select(residue);
    }
    this.#setSelection(
      {
        residues: [
          {
            chainId: residue.chainId,
            insertionCode: residue.insertionCode,
            number: residue.number,
          },
        ],
      },
      `${residue.chainId}:${residue.compId} ${residue.number}${residue.insertionCode}`,
      false,
    );
  }

  dispose(): void {
    this.#sequence.dispose();
  }

  setBackground(background: ViewerBackground): void {
    for (const [choice, control] of this.#backgroundChoices) {
      control.setAttribute('aria-pressed', String(choice === background));
    }
  }

  #buildEntityStrip(): void {
    this.entityStrip.setAttribute('aria-label', 'Chains and ligands');
    this.entityStrip.append(this.#chainList, this.#ligandList);
  }

  #buildInspector(): void {
    this.#representationSelect.setAttribute(
      'aria-label',
      'Structure representation',
    );
    for (const [value, label] of [
      ['cartoon', 'Cartoon'],
      ['surface', 'Surface'],
    ] as const) {
      const option = element('option', { text: label });
      option.value = value;
      this.#representationSelect.append(option);
    }
    this.#representationSelect.addEventListener('change', () => {
      const representation = this.#representationSelect
        .value as StructureRepresentation;
      void this.#validateRepresentation(representation);
    });

    this.#colorSelect.setAttribute('aria-label', 'Structure color');
    for (const [value, label] of [
      ['chain', 'Chain'],
      ['uniform', 'Uniform'],
      ['residue-type', 'Residue type'],
    ] as const) {
      const option = element('option', { text: label });
      option.value = value;
      this.#colorSelect.append(option);
    }
    this.#colorSelect.addEventListener('change', () => {
      const mode = this.#colorSelect.value as StructureColorMode;
      void this.#validateColorMode(mode);
    });

    this.#focusButton.addEventListener('click', () => {
      if (!this.#ensureSelectionForAction()) return;
      if (this.#focusActive) {
        this.#focusActive = false;
        this.#syncSelectionActions();
        this.#callbacks.onResetView();
        return;
      }
      this.#focusActive = true;
      this.#syncSelectionActions();
      this.#callbacks.onFocusSelection();
    });
    this.#isolateButton.addEventListener('click', () => {
      if (!this.#ensureSelectionForAction()) return;
      if (this.#isolateActive) {
        this.#restoreAll();
        return;
      }
      this.#resetSelectionRepresentation();
      this.#hasSelectionColors = false;
      this.#selectionColor = null;
      this.#syncColorSwatches();
      const isolatesWholeChain =
        (this.#selection.chains?.length ?? 0) > 0 &&
        (this.#selection.residues?.length ?? 0) === 0 &&
        (this.#selection.ligands?.length ?? 0) === 0;
      if (!isolatesWholeChain) {
        this.#setSelectValue(
          this.#selectionRepresentationSelect,
          'ball-and-stick',
        );
      }
      this.#isolateActive = true;
      this.#modified = true;
      this.#renderEntities();
      this.#syncModified();
      this.#syncSelectionActions();
      void this.#validateIsolate();
    });
    this.#showAllButton.addEventListener('click', () => this.#restoreAll());

    const modeControls = element('div', { className: 'structure-modes' }, [
      this.#representationSelect,
      this.#colorSelect,
    ]);
    modeControls.setAttribute('role', 'group');
    modeControls.setAttribute('aria-label', 'Structure display');

    const backgroundControl = element('div', { className: 'view-background-control' }, [
      element('span', { text: 'Background' }),
    ]);
    backgroundControl.setAttribute('role', 'group');
    backgroundControl.setAttribute('aria-label', 'Viewer background');
    for (const [background, label] of [['white', 'White'], ['black', 'Black']] as const) {
      const choice = button(label, { className: 'view-background-choice' });
      choice.setAttribute('data-background', background);
      choice.addEventListener('click', () => {
        this.setBackground(background);
        this.#callbacks.onBackground(background);
      });
      this.#backgroundChoices.set(background, choice);
      backgroundControl.append(choice);
    }
    this.setBackground('white');

    const selectionActions = element('div', { className: 'selection-actions' }, [
      this.#selectedLabel,
      this.#focusButton,
      this.#isolateButton,
      this.#showAllButton,
    ]);
    selectionActions.setAttribute('role', 'group');
    selectionActions.setAttribute('aria-label', 'Selection actions');

    const controlBar = element('div', { className: 'structure-controls' }, [
      modeControls,
      selectionActions,
    ]);

    const selectButton = button('Select', { className: 'primary-small' });
    selectButton.addEventListener('click', () => this.#applyTextSelection());
    this.#selectionRepresentationSelect.setAttribute(
      'aria-label',
      'Selected residues representation',
    );
    for (const [value, label] of [
      ['highlight', 'Highlight'],
      ['sticks', 'Sticks'],
      ['ball-and-stick', 'Ball & stick'],
    ] as const) {
      const option = element('option', { text: label });
      option.value = value;
      this.#selectionRepresentationSelect.append(option);
    }
    this.#selectionRepresentationSelect.addEventListener('change', () => {
      const representation = this.#selectionRepresentationSelect
        .value as SelectionRepresentation;
      if (!this.#ensureSelectionForAction()) {
        this.#setSelectValue(this.#selectionRepresentationSelect, 'highlight');
        return;
      }
      this.#setSelectValue(this.#selectionRepresentationSelect, representation);
      void this.#validateSelectionRepresentation(representation);
    });

    const palette = element('div', { className: 'selection-palette' });
    for (const [label, color] of [
      ['Amber', 0xe49b3f],
      ['Blue', 0x4a86c5],
      ['Teal', 0x3f9488],
      ['Magenta', 0xb75b82],
    ] as const) {
      const swatch = button('', { className: 'color-swatch', title: label });
      swatch.style.setProperty('--swatch-color', `#${color.toString(16)}`);
      swatch.setAttribute('data-label', label);
      swatch.setAttribute('aria-label', `Color selection ${label}`);
      swatch.setAttribute('aria-pressed', 'false');
      swatch.addEventListener('click', () => {
        if (!this.#ensureSelectionForAction()) return;
        const previousColor = this.#selectionColor;
        const previousHasColors = this.#hasSelectionColors;
        const previousModified = this.#modified;
        const nextColor = this.#selectionColor === color ? null : color;
        this.#selectionColor = nextColor;
        this.#hasSelectionColors = nextColor !== null;
        this.#modified =
          this.#hasSelectionColors ||
          this.#isolateActive ||
          this.#hiddenChains.size > 0;
        this.#syncColorSwatches();
        this.#syncModified();
        void this.#callbacks.onColorSelection(nextColor).then((completed) => {
          if (completed) return;
          this.#selectionColor = previousColor;
          this.#hasSelectionColors = previousHasColors;
          this.#modified = previousModified;
          this.#syncColorSwatches();
          this.#syncModified();
        });
      });
      this.#colorSwatches.set(color, swatch);
      palette.append(swatch);
    }

    const selectionEditor = element('div', { className: 'selection-editor' }, [
      element('label', { className: 'section-label', text: 'Residues' }),
      this.#selectionInput,
      selectButton,
      this.#selectionRepresentationSelect,
      palette,
    ]);
    this.#selectionInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.#applyTextSelection();
      }
    });

    const customizationSummary = element('summary', {
      className: 'customization-toggle',
      text: 'Customize view',
    });
    const customizationContent = element('div', {
      className: 'customization-content',
    }, [
      this.entityStrip,
      element('div', { className: 'customization-tools' }, [
        controlBar,
        backgroundControl,
        selectionEditor,
        this.#selectionError,
      ]),
      element('div', { className: 'sequence-section' }, [
        element('div', { className: 'sequence-heading' }, [this.#sequenceTitle]),
        this.#sequence.element,
      ]),
    ]);
    this.#customizationPanel.append(
      customizationSummary,
      customizationContent,
    );

    this.inspector.append(this.#customizationPanel);
  }

  #renderEntities(): void {
    this.#chainList.replaceChildren(
      element('span', { className: 'entity-label', text: 'Chains' }),
    );
    this.#ligandList.replaceChildren();
    const metadata = this.#metadata;
    if (metadata === undefined) return;

    for (const chain of metadata.chains) {
      const visible = !this.#hiddenChains.has(chain.authId);
      const wrapper = element('div', { className: 'chain-control' });
      wrapper.classList.toggle('is-hidden', !visible);
      wrapper.setAttribute('role', 'group');
      wrapper.setAttribute('aria-label', `Chain ${chain.authId}`);
      const chip = button(`Chain ${chain.authId}`, {
        className: 'entity-chip chain-chip',
        title: chain.entityDescription || `Chain ${chain.authId}`,
      });
      const selected = this.#selection.chains?.includes(chain.authId) ?? false;
      chip.classList.toggle('is-selected', selected);
      chip.setAttribute(
        'aria-pressed',
        String(selected),
      );
      chip.addEventListener('click', () => this.#selectChain(chain));

      const visibilityLabel = `${visible ? 'Hide' : 'Show'} chain ${chain.authId}`;
      const visibility = button(visible ? 'Hide' : 'Show', {
        className: 'chain-visibility',
        title: visibilityLabel,
      });
      visibility.replaceChildren(
        element('span', { className: 'visibility-icon' }),
      );
      visibility.setAttribute('aria-label', visibilityLabel);
      visibility.setAttribute('aria-pressed', String(visible));
      visibility.classList.toggle('is-active', visible);
      visibility.disabled = this.#isolateActive;
      if (this.#isolateActive) {
        visibility.title = 'Restore all before changing chain visibility';
      }
      visibility.addEventListener('click', () => {
        this.#resetSelectionRepresentation();
        this.#hasSelectionColors = false;
        this.#selectionColor = null;
        this.#syncColorSwatches();
        if (visible) this.#hiddenChains.add(chain.authId);
        else this.#hiddenChains.delete(chain.authId);
        this.#modified = this.#isolateActive || this.#hiddenChains.size > 0;
        this.#syncModified();
        void this.#callbacks.onChainVisible(chain.authId, !visible).then((completed) => {
          if (completed) return;
          if (visible) this.#hiddenChains.delete(chain.authId);
          else this.#hiddenChains.add(chain.authId);
          this.#modified = this.#isolateActive || this.#hiddenChains.size > 0;
          this.#syncModified();
          this.#renderEntities();
        });
        this.#renderEntities();
      });
      wrapper.append(chip, visibility);
      this.#chainList.append(wrapper);
    }

    if (metadata.ligands.length > 0) {
      this.#ligandList.append(
        element('span', { className: 'entity-label', text: 'Ligands' }),
      );
    }
    for (const ligand of metadata.ligands) {
      const label = `${ligand.compId}${ligand.count > 1 ? ` ×${ligand.count}` : ''}`;
      const chip = button(label, {
        className: 'entity-chip ligand-chip',
        title: ligand.name ?? ligand.kind,
      });
      chip.addEventListener('click', () => {
        this.#setSelection(
          { ligands: [{ compId: ligand.compId }] },
          label,
          true,
        );
        this.#callbacks.onSelect(this.#selection, true);
      });
      this.#ligandList.append(chip);
    }
  }

  #selectChain(chain: ChainInfo): void {
    this.#selectedChain = chain.authId;
    this.#setSelection({ chains: [chain.authId] }, `Chain ${chain.authId}`, true);
    this.#renderSequence();
    this.#callbacks.onSelect(this.#selection, true);
  }

  #selectResidue(residue: ResidueInfo): void {
    if (residue.authNumber === undefined) return;
    this.#setSelection(
      {
        residues: [
          {
            chainId: residue.chainId,
            insertionCode: residue.insertionCode,
            number: residue.authNumber,
          },
        ],
      },
      `${residue.chainId}:${residue.compId} ${residue.authNumber}${residue.insertionCode}`,
      false,
    );
    this.#sequence.select({
      chainId: residue.chainId,
      insertionCode: residue.insertionCode,
      number: residue.authNumber,
    });
    this.#callbacks.onSelect(this.#selection, false);
  }

  #renderSequence(): void {
    const chain = this.#metadata?.chains.find(
      (candidate) => candidate.authId === this.#selectedChain,
    );
    this.#sequenceTitle.textContent = chain === undefined
      ? 'Sequence'
      : `Sequence · ${chain.authId}`;
    this.#sequence.setSequence(chain?.authId ?? '', chain?.residues ?? []);
  }

  #applyTextSelection(): boolean {
    const metadata = this.#metadata;
    if (metadata === undefined || this.#selectionInput.value.trim() === '') {
      return this.#hasSelection();
    }

    try {
      const terms = parseResidueSelection(this.#selectionInput.value);
      const residues = resolveResidueSelection(terms, metadata.chains);
      this.#setSelection(
        { residues },
        residues.length === 1
          ? `${residues[0]?.chainId}:${residues[0]?.number}`
          : `${residues.length} residues`,
        false,
        true,
      );
      this.#selectionError.textContent = '';
      this.#callbacks.onSelect(this.#selection, false);
      return true;
    } catch (error) {
      this.#selectionError.textContent =
        error instanceof Error ? error.message : 'Invalid residue selection';
      return false;
    }
  }

  #hasSelection(): boolean {
    return (
      (this.#selection.chains?.length ?? 0) > 0 ||
      (this.#selection.ligands?.length ?? 0) > 0 ||
      (this.#selection.residues?.length ?? 0) > 0
    );
  }

  #ensureSelectionForAction(): boolean {
    return this.#selectionInput.value.trim() === ''
      ? this.#hasSelection()
      : this.#applyTextSelection();
  }

  #syncModified(): void {
    setHidden(this.#showAllButton, !this.#modified);
  }

  #syncSelectionActions(): void {
    const disabled = !this.#hasSelection();
    this.#representationSelect.disabled = this.#isolateActive;
    this.#colorSelect.disabled = this.#isolateActive;
    this.#focusButton.disabled = disabled;
    this.#isolateButton.disabled = disabled;
    this.#selectionRepresentationSelect.disabled =
      disabled || this.#isolateActive;
    this.#focusButton.classList.toggle('is-active', this.#focusActive);
    this.#focusButton.setAttribute('aria-pressed', String(this.#focusActive));
    this.#focusButton.title = this.#focusActive
      ? 'Reset view'
      : 'Focus selection';
    this.#isolateButton.classList.toggle('is-active', this.#isolateActive);
    this.#isolateButton.setAttribute('aria-pressed', String(this.#isolateActive));
    this.#isolateButton.title = this.#isolateActive
      ? 'Restore all structure'
      : 'Isolate selection';
  }

  #setSelection(
    selection: ViewerSelection,
    label: string,
    focus: boolean,
    preserveInput = false,
  ): void {
    this.#resetSelectionFocus(focus);
    this.#selection = selection;
    this.#selectionColor = null;
    this.#selectedLabel.textContent = label;
    if (!preserveInput) this.#selectionInput.value = '';
    this.#selectionError.textContent = '';
    this.#resetSelectionRepresentation();
    this.#renderEntities();
    this.#syncColorSwatches();
    this.#syncSelectionActions();
  }

  #resetSelectionFocus(nextFocus: boolean): void {
    if (this.#focusActive && !nextFocus) this.#callbacks.onResetView();
    this.#focusActive = nextFocus;
  }

  #resetSelectionRepresentation(): void {
    if (this.#selectionRepresentationSelect.value !== 'highlight') {
      this.#setSelectValue(this.#selectionRepresentationSelect, 'highlight');
      void this.#validateSelectionRepresentation('highlight');
    }
  }

  async #validateRepresentation(
    representation: StructureRepresentation,
  ): Promise<void> {
    const request = ++this.#representationRequest;
    const completed = await this.#callbacks.onRepresentation(representation);
    if (completed) this.#representation = representation;
    if (request === this.#representationRequest && !completed) {
      this.#setSelectValue(this.#representationSelect, this.#representation);
    }
  }

  async #validateColorMode(mode: StructureColorMode): Promise<void> {
    const request = ++this.#colorModeRequest;
    const completed = await this.#callbacks.onColorMode(mode);
    if (completed) this.#colorMode = mode;
    if (request === this.#colorModeRequest && !completed) {
      this.#setSelectValue(this.#colorSelect, this.#colorMode);
    }
  }

  async #validateSelectionRepresentation(
    representation: SelectionRepresentation,
  ): Promise<void> {
    const request = ++this.#selectionRepresentationRequest;
    const completed = await this.#callbacks.onSelectionRepresentation(
      representation,
    );
    if (completed) this.#selectionRepresentation = representation;
    if (request === this.#selectionRepresentationRequest && !completed) {
      this.#setSelectValue(
        this.#selectionRepresentationSelect,
        this.#selectionRepresentation,
      );
    }
  }

  async #validateIsolate(): Promise<void> {
    const completed = await this.#callbacks.onIsolate(this.#selection);
    if (completed) return;
    this.#isolateActive = false;
    this.#modified = this.#hiddenChains.size > 0 || this.#hasSelectionColors;
    this.#renderEntities();
    this.#syncModified();
    this.#syncSelectionActions();
  }

  #setSelectValue(select: HTMLSelectElement, value: string): void {
    for (const option of select.options) option.removeAttribute('selected');
    const selected = [...select.options].find((option) => option.value === value);
    if (selected !== undefined) selected.selected = true;
    select.dispatchEvent(new Event(SELECT_VALUE_CHANGED));
  }

  #syncColorSwatches(): void {
    for (const [color, swatch] of this.#colorSwatches) {
      const active = color === this.#selectionColor;
      const label = swatch.getAttribute('data-label') ?? 'selection';
      swatch.classList.toggle('is-active', active);
      swatch.setAttribute('aria-pressed', String(active));
      swatch.setAttribute(
        'aria-label',
        active ? 'Clear all selection colors' : `Color selection ${label}`,
      );
      swatch.title = active ? 'Clear all selection colors' : label;
    }
  }

  #restoreAll(): void {
    const previousFocus = this.#focusActive;
    const previousHasColors = this.#hasSelectionColors;
    const previousHiddenChains = new Set(this.#hiddenChains);
    const previousIsolate = this.#isolateActive;
    const previousModified = this.#modified;
    const previousSelectionColor = this.#selectionColor;
    this.#resetSelectionRepresentation();
    this.#focusActive = false;
    this.#hasSelectionColors = false;
    this.#modified = false;
    this.#isolateActive = false;
    this.#hiddenChains.clear();
    this.#selectionColor = null;
    this.#renderEntities();
    this.#syncColorSwatches();
    this.#syncModified();
    this.#syncSelectionActions();
    void this.#callbacks.onShowAll().then((completed) => {
      if (completed) return;
      this.#focusActive = previousFocus;
      this.#hasSelectionColors = previousHasColors;
      this.#hiddenChains.clear();
      for (const chainId of previousHiddenChains) this.#hiddenChains.add(chainId);
      this.#isolateActive = previousIsolate;
      this.#modified = previousModified;
      this.#selectionColor = previousSelectionColor;
      this.#renderEntities();
      this.#syncColorSwatches();
      this.#syncModified();
      this.#syncSelectionActions();
    });
  }

}
