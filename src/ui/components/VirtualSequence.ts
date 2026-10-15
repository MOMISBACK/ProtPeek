// SPDX-License-Identifier: MPL-2.0
import type { ResidueInfo } from '../../structures/types';
import { residueTargetKey } from '../../sequence/formatResidueSelection';
import type { ResolvedResidueTarget } from '../../sequence/resolveResidueSelection';
import { button, element } from './dom';

const CELL_WIDTH = 34;
const OVERSCAN = 16;

export interface SequenceClickModifiers {
  additive: boolean;
  range: boolean;
}

export interface VirtualSequenceOptions {
  onResidueClick(residue: ResidueInfo, modifiers: SequenceClickModifiers): void;
}

export class VirtualSequence {
  readonly element = element('div', { className: 'sequence-scroll' });
  readonly #layer = element('div', { className: 'sequence-layer' });
  readonly #spacer = element('div', { className: 'sequence-spacer' });
  readonly #options: VirtualSequenceOptions;
  readonly #resizeObserver: ResizeObserver;
  #chainId = '';
  #residues: readonly ResidueInfo[] = [];
  #selectedKeys = new Set<string>();
  #start = -1;
  #end = -1;

  constructor(options: VirtualSequenceOptions) {
    this.#options = options;
    this.element.tabIndex = 0;
    this.element.setAttribute('aria-label', 'Chain sequence');
    this.element.append(this.#spacer, this.#layer);
    this.element.addEventListener('scroll', () => this.#render());
    this.#resizeObserver = new ResizeObserver(() => this.#render());
    this.#resizeObserver.observe(this.element);
  }

  setSequence(chainId: string, residues: readonly ResidueInfo[]): void {
    this.#chainId = chainId;
    this.#residues = residues;
    this.#spacer.style.width = `${Math.max(1, residues.length * CELL_WIDTH)}px`;
    this.element.scrollLeft = 0;
    this.#start = -1;
    this.#end = -1;
    this.#render();
  }

  setSelection(
    residues: readonly ResolvedResidueTarget[],
    scrollTo?: ResolvedResidueTarget,
  ): void {
    this.#selectedKeys = new Set(residues.map(residueTargetKey));
    if (scrollTo?.chainId === this.#chainId) {
      const index = this.#residues.findIndex((item) =>
        item.authNumber === scrollTo.number &&
        item.insertionCode === (scrollTo.insertionCode ?? ''),
      );
      if (index >= 0) {
        const left = index * CELL_WIDTH;
        const right = left + CELL_WIDTH;
        if (left < this.element.scrollLeft) this.element.scrollLeft = left;
        else if (right > this.element.scrollLeft + this.element.clientWidth) {
          this.element.scrollLeft = right - this.element.clientWidth;
        }
      }
    }
    // Virtualized cells must also be updated when the visible range is unchanged.
    this.#start = -1;
    this.#render();
  }

  dispose(): void {
    this.#resizeObserver.disconnect();
  }

  #render(): void {
    const visibleCount = Math.ceil(this.element.clientWidth / CELL_WIDTH);
    const start = Math.max(
      0,
      Math.floor(this.element.scrollLeft / CELL_WIDTH) - OVERSCAN,
    );
    const end = Math.min(
      this.#residues.length,
      start + visibleCount + OVERSCAN * 2,
    );
    if (start === this.#start && end === this.#end) return;
    this.#start = start;
    this.#end = end;
    this.#layer.replaceChildren();
    this.#layer.style.transform = `translateX(${start * CELL_WIDTH}px)`;

    for (let index = start; index < end; index += 1) {
      const residue = this.#residues[index];
      if (residue === undefined) continue;
      const number = residue.authNumber ?? residue.labelNumber ?? index + 1;
      const item = button('', { className: 'residue-cell' });
      const key = `${residue.chainId}:${number}:${residue.insertionCode}`;
      const selected = this.#selectedKeys.has(key);
      item.classList.toggle('is-selected', selected);
      item.setAttribute('aria-pressed', String(selected));
      item.classList.toggle('is-missing', !residue.isObserved);
      item.disabled = !residue.isObserved;
      item.style.width = `${CELL_WIDTH}px`;
      item.title = residue.isObserved
        ? `Chain ${residue.chainId} · ${residue.compId} ${number}${residue.insertionCode}`
        : `Chain ${residue.chainId} · ${residue.compId} ${residue.labelNumber ?? ''} · not observed`;
      item.setAttribute('aria-label', item.title);
      item.append(
        element('span', { className: 'residue-code', text: residue.code }),
        element('span', {
          className: 'residue-number',
          text: `${number}${residue.insertionCode}`,
        }),
      );
      item.addEventListener('click', (event) => this.#options.onResidueClick(residue, {
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      }));
      this.#layer.append(item);
    }
  }
}
