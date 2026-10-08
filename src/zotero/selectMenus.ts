// SPDX-License-Identifier: MPL-2.0
import { button, element, SELECT_VALUE_CHANGED } from '../ui/components/dom';

let nextMenuId = 0;

// Native <select> popups are unreliable in Zotero's privileged iframe windows.
// Keep the shared select as the source of truth and use ordinary HTML controls
// for the Zotero popup, including programmatic resets and disabled states.
export class ZoteroSelectMenu {
  readonly element = element('div', { className: 'zotero-select' });
  readonly #select: HTMLSelectElement;
  readonly #trigger = button('', { className: 'compact-select zotero-select-trigger' });
  readonly #menu = element('div', { className: 'zotero-select-menu' });
  readonly #observer: MutationObserver;
  readonly #document: Document;
  readonly #originalHidden: HTMLSelectElement['hidden'];
  #options: HTMLButtonElement[] = [];
  #activeIndex = 0;

  constructor(select: HTMLSelectElement) {
    this.#select = select;
    this.#document = select.ownerDocument;
    this.#originalHidden = select.hidden;
    this.#menu.id = `protpeek-select-menu-${++nextMenuId}`;
    this.#menu.hidden = true;
    this.#menu.setAttribute('role', 'listbox');
    this.#trigger.setAttribute('role', 'combobox');
    this.#trigger.setAttribute('aria-haspopup', 'listbox');
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.setAttribute('aria-controls', this.#menu.id);
    if (select.classList.contains('selection-representation')) {
      this.element.classList.add('selection-representation');
    }
    this.element.append(this.#trigger, this.#menu);
    select.after(this.element);
    select.hidden = true;
    this.#trigger.addEventListener('click', () => this.#toggle());
    this.#trigger.addEventListener('keydown', this.#onKeyDown);
    select.addEventListener('change', this.#sync);
    select.addEventListener(SELECT_VALUE_CHANGED, this.#sync);
    this.#document.addEventListener('pointerdown', this.#onOutsidePointer);
    this.#document.addEventListener('focusin', this.#onOutsideFocus);
    this.#observer = new MutationObserver(this.#sync);
    this.#observer.observe(select, {
      attributes: true,
      attributeFilter: ['disabled', 'selected', 'value', 'label', 'aria-label'],
      childList: true,
      subtree: true,
      characterData: true,
    });
    this.#sync();
  }

  dispose(): void {
    this.#observer.disconnect();
    this.#select.removeEventListener('change', this.#sync);
    this.#select.removeEventListener(SELECT_VALUE_CHANGED, this.#sync);
    this.#document.removeEventListener('pointerdown', this.#onOutsidePointer);
    this.#document.removeEventListener('focusin', this.#onOutsideFocus);
    this.#select.hidden = this.#originalHidden;
    this.element.remove();
  }

  readonly #sync = (): void => {
    const label = this.#select.getAttribute('aria-label') ?? '';
    this.#trigger.setAttribute('aria-label', label);
    this.#menu.setAttribute('aria-label', label);
    this.#trigger.disabled = this.#select.disabled;
    this.#trigger.setAttribute('aria-disabled', String(this.#select.disabled));
    const selected = [...this.#select.options].find(option => option.value === this.#select.value);
    this.#trigger.textContent = selected?.label || selected?.textContent || '';
    this.#options = [...this.#select.options].map((option, index) => {
      const choice = button(option.label || option.textContent || '', { className: 'zotero-select-option' });
      choice.id = `${this.#menu.id}-${index}`;
      choice.tabIndex = -1;
      choice.disabled = option.disabled;
      choice.setAttribute('role', 'option');
      choice.setAttribute('data-value', option.value);
      choice.setAttribute('aria-selected', String(option.value === this.#select.value));
      choice.addEventListener('pointermove', () => this.#setActive(index));
      choice.addEventListener('click', () => this.#choose(index));
      return choice;
    });
    this.#menu.replaceChildren(...this.#options);
    this.#activeIndex = Math.max(0, [...this.#select.options].findIndex(option => option.value === this.#select.value));
    if (this.#select.disabled) this.#close();
    else if (!this.#menu.hidden) this.#setActive(this.#activeIndex);
  };

  #toggle(): void {
    if (this.#menu.hidden) this.#open();
    else this.#close();
  }

  #open(): void {
    if (this.#select.disabled) return;
    this.#sync();
    this.#menu.hidden = false;
    this.#trigger.setAttribute('aria-expanded', 'true');
    this.#setActive(this.#activeIndex);
  }

  #close(): void {
    this.#menu.hidden = true;
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.removeAttribute('aria-activedescendant');
  }

  #setActive(index: number): void {
    const option = this.#options[index];
    if (option === undefined || option.disabled) return;
    this.#activeIndex = index;
    for (const [i, choice] of this.#options.entries()) {
      choice.classList.toggle('is-active', i === index);
    }
    this.#trigger.setAttribute('aria-activedescendant', option.id);
  }

  #choose(index: number): void {
    const option = this.#select.options[index];
    if (this.#select.disabled || option === undefined || option.disabled) return;
    for (const candidate of this.#select.options) candidate.removeAttribute('selected');
    option.selected = true;
    this.#close();
    this.#trigger.focus();
    this.#select.dispatchEvent(new Event('change', { bubbles: true }));
    this.#sync();
  }

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (this.#select.disabled) return;
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape' && !this.#menu.hidden) event.preventDefault();
      this.#close();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.#menu.hidden) this.#open();
      else this.#choose(this.#activeIndex);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const wasClosed = this.#menu.hidden;
    if (wasClosed) this.#open();
    const available = this.#options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
    if (available.length === 0) return;
    let index: number | undefined;
    if (event.key === 'Home') index = available[0];
    else if (event.key === 'End') index = available.at(-1);
    else if (wasClosed) index = this.#options[this.#activeIndex]?.disabled ? available[0] : this.#activeIndex;
    else {
      const position = available.indexOf(this.#activeIndex);
      index = available[(position + (event.key === 'ArrowDown' ? 1 : -1) + available.length) % available.length];
    }
    if (index !== undefined) this.#setActive(index);
  };

  readonly #onOutsidePointer = (event: Event): void => {
    if (!this.element.contains(event.target as Node | null)) this.#close();
  };

  readonly #onOutsideFocus = (event: Event): void => {
    if (!this.element.contains(event.target as Node | null)) this.#close();
  };
}

export function initializeZoteroSelectMenus(root: HTMLElement): () => void {
  const menus = [...root.querySelectorAll<HTMLSelectElement>('select.compact-select')]
    .map(select => new ZoteroSelectMenu(select));
  return () => { for (const menu of menus) menu.dispose(); };
}
