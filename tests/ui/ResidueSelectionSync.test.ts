// SPDX-License-Identifier: MPL-2.0
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructurePanel, type StructurePanelCallbacks } from '../../src/ui/components/StructurePanel';
import type { ChainInfo, ResidueInfo, StructureMetadata } from '../../src/structures/types';

const residue = (chainId: string, number: number, insertionCode = ''): ResidueInfo => ({
  chainId, authNumber: number, insertionCode, code: 'A', compId: 'ALA',
  isObserved: true, labelNumber: number,
});
const chain = (authId: string, residues: ResidueInfo[]): ChainInfo => ({
  authId, labelId: authId, entityId: authId, entityDescription: '',
  polymerType: 'polypeptide(L)', residues,
});
const metadata: StructureMetadata = {
  atomCount: 100,
  chains: [
    chain('A', [
      residue('A', 5), residue('A', 7), residue('A', 8), residue('A', 9),
      residue('A', 10), residue('A', 11), residue('A', 11, 'A'), residue('A', 12),
    ]),
    chain('B', [residue('B', 3)]),
  ],
  ligands: [],
  source: { kind: 'pdb', id: '1crn' },
};

function callbacks(): StructurePanelCallbacks {
  return {
    onBackground: vi.fn(), onChainVisible: vi.fn(async () => true),
    onColorMode: vi.fn(async () => true), onColorSelection: vi.fn(async () => true),
    onFocusSelection: vi.fn(), onIsolate: vi.fn(async () => true),
    onRepresentation: vi.fn(async () => true), onResetView: vi.fn(),
    onSelect: vi.fn(), onSelectionRepresentation: vi.fn(async () => true),
    onShowAll: vi.fn(async () => true),
  };
}

function clickResidue(
  panel: StructurePanel, number: string,
  modifiers: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {},
): void {
  const cell = [...panel.inspector.querySelectorAll<HTMLButtonElement>('.residue-cell')]
    .find((item) => item.querySelector('.residue-number')?.textContent === number);
  if (!cell) throw new Error(`Residue ${number} is not visible`);
  const event = new Event('click', { bubbles: true });
  Object.defineProperties(event, {
    ctrlKey: { value: modifiers.ctrl ?? false },
    metaKey: { value: modifiers.meta ?? false },
    shiftKey: { value: modifiers.shift ?? false },
  });
  cell.dispatchEvent(event);
}

function selectionInput(panel: StructurePanel): HTMLInputElement {
  const input = panel.inspector.querySelector<HTMLInputElement>('.selection-input');
  if (!input) throw new Error('Missing Residues input');
  return input;
}

function selectedNumbers(panel: StructurePanel): string[] {
  return [...panel.inspector.querySelectorAll<HTMLButtonElement>('.residue-cell.is-selected')]
    .map((item) => item.querySelector('.residue-number')?.textContent ?? '');
}

describe('Residues input / sequence / viewer synchronization', () => {
  beforeEach(() => {
    const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal('ResizeObserver', class {
      disconnect(): void {}
      observe(): void {}
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function panelWithMetadata(): { panel: StructurePanel; spies: StructurePanelCallbacks } {
    const spies = callbacks();
    const panel = new StructurePanel(spies);
    const sequence = panel.inspector.querySelector('.sequence-scroll');
    Object.defineProperty(sequence, 'clientWidth', { value: 320 });
    panel.setMetadata(metadata);
    return { panel, spies };
  }

  it('syncs a plain click, Ctrl/Cmd toggles and Shift ranges', () => {
    const { panel, spies } = panelWithMetadata();
    expect(panel.inspector.querySelector('.selected-label')).toBeNull();
    clickResidue(panel, '5');
    expect(selectionInput(panel).value).toBe('A:5');
    expect(selectedNumbers(panel)).toEqual(['5']);
    expect(spies.onSelect).toHaveBeenLastCalledWith({
      residues: [{ chainId: 'A', number: 5 }],
    }, false);

    clickResidue(panel, '7', { ctrl: true });
    clickResidue(panel, '8', { meta: true });
    expect(selectionInput(panel).value).toBe('A:5,7-8');
    expect(selectedNumbers(panel)).toEqual(['5', '7', '8']);
    clickResidue(panel, '7', { ctrl: true });
    expect(selectionInput(panel).value).toBe('A:5,8');
    expect(selectedNumbers(panel)).toEqual(['5', '8']);

    clickResidue(panel, '7');
    clickResidue(panel, '9', { shift: true });
    expect(selectionInput(panel).value).toBe('A:7-9');
    expect(selectedNumbers(panel)).toEqual(['7', '8', '9']);
    panel.dispose();
  });

  it('keeps insertion-coded residues distinct and includes them in Shift ranges', () => {
    const { panel } = panelWithMetadata();
    clickResidue(panel, '11A');
    expect(selectionInput(panel).value).toBe('A:11A');
    expect(selectedNumbers(panel)).toEqual(['11A']);
    clickResidue(panel, '11');
    expect(selectionInput(panel).value).toBe('A:11');
    clickResidue(panel, '10');
    clickResidue(panel, '12', { shift: true });
    expect(selectionInput(panel).value).toBe('A:10,11,11A,12');
    expect(selectedNumbers(panel)).toEqual(['10', '11', '11A', '12']);
    panel.dispose();
  });

  it('commits typed selections only on Select, preserving invalid drafts', () => {
    const { panel, spies } = panelWithMetadata();
    const input = selectionInput(panel);
    input.value = 'A:5,7-9,B:3';
    const select = [...panel.inspector.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Select');
    if (!select) throw new Error('Missing Select button');
    expect(spies.onSelect).not.toHaveBeenCalled();
    select.click();
    expect(input.value).toBe('A:5,7-9,B:3');
    expect(selectedNumbers(panel)).toEqual(['5', '7', '8', '9']);
    expect(spies.onSelect).toHaveBeenCalledTimes(1);

    input.value = 'A:404';
    select.click();
    expect(panel.inspector.querySelector('.field-error')?.textContent)
      .toContain('not observed');
    expect(spies.onSelect).toHaveBeenCalledTimes(1);
    const focus = [...panel.inspector.querySelectorAll<HTMLButtonElement>('button')]
      .find((item) => item.textContent === 'Focus');
    focus?.click();
    expect(input.value).toBe('A:404');
    expect(spies.onSelect).toHaveBeenCalledTimes(1);

    input.value = '';
    select.click();
    expect(spies.onSelect).toHaveBeenLastCalledWith({}, false);
    expect(selectedNumbers(panel)).toEqual([]);
    panel.dispose();
  });

  it('reflects direct 3D picks across chains and clears stale selections', () => {
    const { panel } = panelWithMetadata();
    panel.highlightResidue({ chainId: 'B', compId: 'ALA', number: 3, insertionCode: '' });
    expect(selectionInput(panel).value).toBe('B:3');
    expect(panel.inspector.querySelector('.sequence-heading')?.textContent)
      .toContain('B');
    expect(selectedNumbers(panel)).toEqual(['3']);
    panel.highlightResidue({ chainId: 'A', compId: 'ALA', number: 11, insertionCode: 'A' });
    expect(selectionInput(panel).value).toBe('A:11A');
    expect(selectedNumbers(panel)).toEqual(['11A']);
    panel.highlightResidue(null);
    expect(selectionInput(panel).value).toBe('');
    expect(selectedNumbers(panel)).toEqual([]);
    panel.dispose();
  });
});
