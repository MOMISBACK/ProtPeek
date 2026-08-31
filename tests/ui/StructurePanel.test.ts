// SPDX-License-Identifier: MPL-2.0
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { StructureMetadata } from '../../src/structures/types';
import {
  StructurePanel,
  type StructurePanelCallbacks,
} from '../../src/ui/components/StructurePanel';

const METADATA: StructureMetadata = {
  atomCount: 2,
  chains: [
    {
      authId: 'A',
      entityDescription: 'Test protein',
      entityId: '1',
      labelId: 'A',
      polymerType: 'polypeptide(L)',
      residues: [
        {
          authNumber: 5,
          chainId: 'A',
          code: 'G',
          compId: 'GLY',
          insertionCode: '',
          isObserved: true,
          labelNumber: 1,
        },
      ],
    },
  ],
  ligands: [],
  source: { kind: 'pdb', id: '1crn' },
};

const SELECTED_RESIDUE = {
  chainId: 'A',
  compId: 'GLY',
  insertionCode: '',
  number: 5,
};

function createCallbacks(): StructurePanelCallbacks {
  return {
    onChainVisible: vi.fn(async () => true),
    onColorMode: vi.fn(async () => true),
    onColorSelection: vi.fn(async () => true),
    onFocusSelection: vi.fn(),
    onIsolate: vi.fn(async () => true),
    onRepresentation: vi.fn(async () => true),
    onResetView: vi.fn(),
    onSelect: vi.fn(),
    onSelectionRepresentation: vi.fn(async () => true),
    onShowAll: vi.fn(async () => true),
  };
}

function buttonNamed(root: ParentNode, label: string): HTMLButtonElement {
  const match = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (match === undefined) throw new Error(`Missing button: ${label}`);
  return match;
}

function choose(select: HTMLSelectElement, value: string): void {
  for (const option of select.options) option.removeAttribute('selected');
  const selected = [...select.options].find((option) => option.value === value);
  if (selected !== undefined) selected.selected = true;
  select.dispatchEvent(new Event('change'));
}

describe('StructurePanel compact controls', () => {
  beforeEach(() => {
    const { document, window } = parseHTML(
      '<!doctype html><html><body></body></html>',
    );
    vi.stubGlobal('document', document);
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect(): void {}
        observe(): void {}
      },
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it('groups coherent controls and exposes every action reversibly', () => {
    const callbacks = createCallbacks();
    const panel = new StructurePanel(callbacks);
    const sequence = panel.inspector.querySelector('.sequence-scroll');
    Object.defineProperty(sequence, 'clientWidth', { value: 320 });

    panel.setMetadata(METADATA);

    const modes = panel.inspector.querySelector('.structure-modes');
    const modeSelects = modes?.querySelectorAll<HTMLSelectElement>('select');
    expect(modeSelects).toHaveLength(2);
    expect(modeSelects?.[0]?.getAttribute('aria-label')).toBe(
      'Structure representation',
    );
    expect(
      [...(modeSelects?.[0]?.options ?? [])].map((option) => option.textContent),
    ).toEqual(['Cartoon', 'Surface']);
    expect(modeSelects?.[1]?.getAttribute('aria-label')).toBe(
      'Structure color',
    );

    const actions = panel.inspector.querySelector('.selection-actions');
    const focus = buttonNamed(actions ?? panel.inspector, 'Focus');
    const isolate = buttonNamed(actions ?? panel.inspector, 'Isolate');
    const showAll = buttonNamed(actions ?? panel.inspector, 'Show all');
    expect(showAll.parentElement).toBe(actions);
    expect(focus.disabled).toBe(true);
    expect(isolate.disabled).toBe(true);
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    expect(isolate.getAttribute('aria-pressed')).toBe('false');
    expect(showAll.hidden).toBe(true);

    const selectedRepresentation = panel.inspector.querySelector<HTMLSelectElement>(
      '[aria-label="Selected residues representation"]',
    );
    expect(selectedRepresentation?.disabled).toBe(true);
    expect(
      [...(selectedRepresentation?.options ?? [])].map(
        (option) => option.textContent,
      ),
    ).toEqual(['Highlight', 'Sticks', 'Ball & stick']);

    panel.setBusy(true);
    expect(panel.entityStrip.inert).toBe(true);
    expect(panel.inspector.getAttribute('aria-busy')).toBe('true');
    panel.setBusy(false);
    expect(panel.entityStrip.inert).toBe(false);
    expect(panel.inspector.getAttribute('aria-busy')).toBe('false');

    expect(panel.entityStrip.querySelector('details')).toBeNull();
    const chain = panel.entityStrip.querySelector<HTMLButtonElement>('.chain-chip');
    expect(chain?.textContent).toBe('Chain A');
    let visibility = panel.entityStrip.querySelector<HTMLButtonElement>(
      '.chain-visibility',
    );
    expect(visibility?.getAttribute('aria-label')).toBe('Hide chain A');
    expect(visibility?.getAttribute('aria-pressed')).toBe('true');
    expect(visibility?.classList.contains('is-active')).toBe(true);

    visibility?.click();
    expect(callbacks.onChainVisible).toHaveBeenLastCalledWith('A', false);
    visibility = panel.entityStrip.querySelector('.chain-visibility');
    expect(visibility?.getAttribute('aria-label')).toBe('Show chain A');
    expect(visibility?.getAttribute('aria-pressed')).toBe('false');
    expect(showAll.hidden).toBe(false);

    visibility?.click();
    expect(callbacks.onChainVisible).toHaveBeenLastCalledWith('A', true);
    expect(showAll.hidden).toBe(true);

    chain?.click();
    expect(callbacks.onSelect).toHaveBeenCalledWith({ chains: ['A'] }, true);
    expect(focus.disabled).toBe(false);
    expect(isolate.disabled).toBe(false);
    expect(focus.getAttribute('aria-pressed')).toBe('true');
    expect(selectedRepresentation?.disabled).toBe(false);

    panel.highlightResidue(SELECTED_RESIDUE);
    expect(callbacks.onResetView).toHaveBeenCalledTimes(1);
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    focus.click();
    expect(callbacks.onFocusSelection).toHaveBeenCalledTimes(1);
    expect(focus.getAttribute('aria-pressed')).toBe('true');
    expect(focus.classList.contains('is-active')).toBe(true);
    focus.click();
    expect(callbacks.onResetView).toHaveBeenCalledTimes(2);
    expect(focus.getAttribute('aria-pressed')).toBe('false');

    const amber = panel.inspector.querySelector<HTMLButtonElement>(
      '.color-swatch',
    );
    amber?.click();
    expect(callbacks.onColorSelection).toHaveBeenLastCalledWith(0xe49b3f);
    expect(amber?.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.hidden).toBe(false);
    amber?.click();
    expect(callbacks.onColorSelection).toHaveBeenLastCalledWith(null);
    expect(amber?.getAttribute('aria-pressed')).toBe('false');
    expect(showAll.hidden).toBe(true);

    focus.click();
    isolate.click();
    expect(callbacks.onIsolate).toHaveBeenCalledWith({
      residues: [{ chainId: 'A', insertionCode: '', number: 5 }],
    });
    expect(isolate.getAttribute('aria-pressed')).toBe('true');
    expect(isolate.classList.contains('is-active')).toBe(true);
    expect(showAll.hidden).toBe(false);
    isolate.click();
    expect(callbacks.onShowAll).toHaveBeenCalledTimes(1);
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    expect(isolate.getAttribute('aria-pressed')).toBe('false');
    expect(showAll.hidden).toBe(true);

    if (selectedRepresentation !== null) {
      choose(selectedRepresentation, 'sticks');
    }
    expect(callbacks.onSelectionRepresentation).toHaveBeenLastCalledWith(
      'sticks',
    );
    if (selectedRepresentation !== null) {
      choose(selectedRepresentation, 'ball-and-stick');
    }
    expect(callbacks.onSelectionRepresentation).toHaveBeenLastCalledWith(
      'ball-and-stick',
    );

    const representation = modeSelects?.[0];
    if (representation !== undefined) {
      choose(representation, 'surface');
    }
    expect(callbacks.onRepresentation).toHaveBeenCalledWith('surface');
    expect(panel.inspector.querySelector('.residue-number')?.textContent).toBe(
      '5',
    );
    panel.dispose();
  });

  it('synchronizes toggle state across selection, restore, reload, and clear', () => {
    const callbacks = createCallbacks();
    const panel = new StructurePanel(callbacks);
    const sequence = panel.inspector.querySelector('.sequence-scroll');
    Object.defineProperty(sequence, 'clientWidth', { value: 320 });
    panel.setMetadata(METADATA);

    const focus = buttonNamed(panel.inspector, 'Focus');
    const isolate = buttonNamed(panel.inspector, 'Isolate');
    const showAll = buttonNamed(panel.inspector, 'Show all');
    const selectedRepresentation = panel.inspector.querySelector<HTMLSelectElement>(
      '[aria-label="Selected residues representation"]',
    );
    panel.entityStrip.querySelector<HTMLButtonElement>('.chain-chip')?.click();
    isolate.click();
    if (selectedRepresentation !== null) {
      choose(selectedRepresentation, 'sticks');
    }

    panel.highlightResidue(SELECTED_RESIDUE);
    expect(callbacks.onResetView).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectionRepresentation).toHaveBeenLastCalledWith(
      'highlight',
    );
    expect(selectedRepresentation?.value).toBe('highlight');
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    expect(isolate.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.hidden).toBe(false);

    panel.highlightResidue(null);
    expect(focus.disabled).toBe(true);
    expect(isolate.disabled).toBe(true);
    expect(isolate.getAttribute('aria-pressed')).toBe('true');
    expect(showAll.hidden).toBe(false);
    showAll.click();
    expect(callbacks.onShowAll).toHaveBeenCalledTimes(1);
    expect(isolate.getAttribute('aria-pressed')).toBe('false');
    expect(showAll.hidden).toBe(true);

    const globalSelects = panel.inspector.querySelectorAll<HTMLSelectElement>(
      '.structure-modes select',
    );
    if (globalSelects[0] !== undefined) {
      choose(globalSelects[0], 'surface');
    }
    if (globalSelects[1] !== undefined) {
      choose(globalSelects[1], 'uniform');
    }
    panel.setMetadata(METADATA);
    expect(globalSelects[0]?.value).toBe('cartoon');
    expect(globalSelects[1]?.value).toBe('chain');
    expect(selectedRepresentation?.value).toBe('highlight');
    expect(selectedRepresentation?.disabled).toBe(true);
    expect(focus.getAttribute('aria-pressed')).toBe('false');
    expect(isolate.getAttribute('aria-pressed')).toBe('false');

    panel.entityStrip.querySelector<HTMLButtonElement>('.chain-chip')?.click();
    expect(focus.getAttribute('aria-pressed')).toBe('true');
    panel.setModified(false);
    expect(focus.getAttribute('aria-pressed')).toBe('false');

    panel.clear();
    expect(panel.entityStrip.hidden).toBe(true);
    expect(panel.inspector.hidden).toBe(true);
    panel.dispose();
  });

  it('rolls controls back when a viewer action does not complete', async () => {
    const callbacks = createCallbacks();
    vi.mocked(callbacks.onRepresentation).mockResolvedValue(false);
    vi.mocked(callbacks.onColorMode).mockResolvedValue(false);
    vi.mocked(callbacks.onChainVisible).mockResolvedValue(false);
    vi.mocked(callbacks.onColorSelection).mockResolvedValue(false);
    vi.mocked(callbacks.onIsolate).mockResolvedValue(false);
    const panel = new StructurePanel(callbacks);
    const sequence = panel.inspector.querySelector('.sequence-scroll');
    Object.defineProperty(sequence, 'clientWidth', { value: 320 });
    panel.setMetadata(METADATA);

    const representation = panel.inspector.querySelector<HTMLSelectElement>(
      '[aria-label="Structure representation"]',
    );
    const colorMode = panel.inspector.querySelector<HTMLSelectElement>(
      '[aria-label="Structure color"]',
    );
    if (representation !== null) choose(representation, 'surface');
    if (colorMode !== null) choose(colorMode, 'uniform');
    await Promise.resolve();
    expect(representation?.value).toBe('cartoon');
    expect(colorMode?.value).toBe('chain');

    panel.entityStrip.querySelector<HTMLButtonElement>('.chain-visibility')?.click();
    await Promise.resolve();
    expect(
      panel.entityStrip
        .querySelector<HTMLButtonElement>('.chain-visibility')
        ?.getAttribute('aria-label'),
    ).toBe('Hide chain A');

    panel.highlightResidue(SELECTED_RESIDUE);
    const amber = panel.inspector.querySelector<HTMLButtonElement>(
      '.color-swatch',
    );
    amber?.click();
    const isolate = buttonNamed(panel.inspector, 'Isolate');
    isolate.click();
    await Promise.resolve();
    expect(amber?.getAttribute('aria-pressed')).toBe('false');
    expect(isolate.getAttribute('aria-pressed')).toBe('false');

    panel.dispose();
  });
});
