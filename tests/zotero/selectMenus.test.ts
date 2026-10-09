// SPDX-License-Identifier: MPL-2.0
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SELECT_VALUE_CHANGED } from '../../src/ui/components/dom';
import { StructurePanel } from '../../src/ui/components/StructurePanel';
import { initializeZoteroSelectMenus, ZoteroSelectMenu } from '../../src/zotero/selectMenus';

function createSelect(): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'compact-select';
  select.setAttribute('aria-label', 'Structure representation');
  for (const [value, label] of [['cartoon', 'Cartoon'], ['surface', 'Surface']]) {
    const option = document.createElement('option');
    option.value = value ?? '';
    option.textContent = label ?? '';
    select.append(option);
  }
  const first = select.options[0];
  if (first !== undefined) first.selected = true;
  document.body.append(select);
  return select;
}

function triggerFor(menu: ZoteroSelectMenu): HTMLButtonElement {
  const trigger = menu.element.querySelector<HTMLButtonElement>('[role=combobox]');
  if (trigger === null) throw new Error('Missing Zotero control');
  return trigger;
}

function key(target: HTMLElement, value: string): void {
  const event = new Event('keydown', { bubbles: true, cancelable: true });
  Object.assign(event, { key: value });
  target.dispatchEvent(event);
}

describe('Zotero structure menus', () => {
  beforeEach(() => {
    const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
    vi.stubGlobal('document', document);
    vi.stubGlobal('Event', window.Event);
    vi.stubGlobal('MutationObserver', window.MutationObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lets a pointer choose an option through the existing change handler', () => {
    const select = createSelect();
    const change = vi.fn();
    select.addEventListener('change', change);
    const menu = new ZoteroSelectMenu(select);
    const trigger = triggerFor(menu);
    expect(select.hidden).toBe(true);
    expect(trigger.textContent).toBe('Cartoon');
    expect(trigger.getAttribute('aria-label')).toBe('Structure representation');
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    menu.element.querySelector<HTMLButtonElement>('[data-value="surface"]')?.click();
    expect(select.value).toBe('surface');
    expect(trigger.textContent).toBe('Surface');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(change).toHaveBeenCalledOnce();
    expect(menu.element.querySelector('[data-value="surface"]')?.getAttribute('aria-selected')).toBe('true');
    menu.dispose();
  });

  it('supports keyboard choice, Escape and Tab without unwanted changes', () => {
    const select = createSelect();
    const change = vi.fn();
    select.addEventListener('change', change);
    const menu = new ZoteroSelectMenu(select);
    const trigger = triggerFor(menu);
    key(trigger, 'ArrowDown');
    key(trigger, 'ArrowDown');
    const activeId = trigger.getAttribute('aria-activedescendant') ?? '';
    expect(document.getElementById(activeId)?.textContent).toBe('Surface');
    key(trigger, 'Enter');
    expect(select.value).toBe('surface');
    expect(change).toHaveBeenCalledOnce();
    key(trigger, ' ');
    key(trigger, 'Home');
    key(trigger, 'Escape');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(select.value).toBe('surface');
    key(trigger, 'ArrowUp');
    key(trigger, 'Tab');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(change).toHaveBeenCalledOnce();
    menu.dispose();
  });

  it('reflects programmatic rollback after the viewer rejects a change', () => {
    const select = createSelect();
    const menu = new ZoteroSelectMenu(select);
    const trigger = triggerFor(menu);
    trigger.click();
    menu.element.querySelector<HTMLButtonElement>('[data-value="surface"]')?.click();
    for (const option of select.options) option.removeAttribute('selected');
    const cartoon = select.options[0];
    if (cartoon !== undefined) cartoon.selected = true;
    select.dispatchEvent(new Event(SELECT_VALUE_CHANGED));
    expect(trigger.textContent).toBe('Cartoon');
    expect(menu.element.querySelector('[data-value="cartoon"]')?.getAttribute('aria-selected')).toBe('true');
    menu.dispose();
  });

  it('stays synchronized when the actual structure panel rejects a representation', async () => {
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} });
    const onRepresentation = vi.fn(async () => false);
    const panel = new StructurePanel({
      onBackground: () => undefined,
      onChainVisible: async () => true,
      onColorMode: async () => true,
      onColorSelection: async () => true,
      onFocusSelection: () => {},
      onIsolate: async () => true,
      onRepresentation,
      onResetView: () => {},
      onSelect: () => {},
      onSelectionRepresentation: async () => true,
      onShowAll: async () => true,
    });
    document.body.append(panel.inspector);
    panel.setMetadata({ atomCount: 0, chains: [], ligands: [], source: { kind: 'pdb', id: '1crn' } });
    const disposeMenus = initializeZoteroSelectMenus(document.body);
    const trigger = document.querySelector<HTMLButtonElement>('[role=combobox][aria-label="Structure representation"]');
    trigger?.click();
    trigger?.parentElement?.querySelector<HTMLButtonElement>('[data-value="surface"]')?.click();
    await vi.waitFor(() => expect(trigger?.textContent).toBe('Cartoon'));
    expect(onRepresentation).toHaveBeenCalledWith('surface');
    disposeMenus();
    panel.dispose();
  });

  it('closes and disables the menu when isolation or selection state disables the select', async () => {
    const select = createSelect();
    const change = vi.fn();
    select.addEventListener('change', change);
    const menu = new ZoteroSelectMenu(select);
    const trigger = triggerFor(menu);
    trigger.click();
    select.disabled = true;
    await vi.waitFor(() => expect(trigger.disabled).toBe(true));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    key(trigger, 'Enter');
    menu.element.querySelector<HTMLButtonElement>('[data-value="surface"]')?.click();
    expect(select.value).toBe('cartoon');
    expect(change).not.toHaveBeenCalled();
    select.disabled = false;
    await vi.waitFor(() => expect(trigger.disabled).toBe(false));
    trigger.click();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    menu.dispose();
  });

  it('closes on an outside pointer or focus without changing the value', () => {
    const select = createSelect();
    const menu = new ZoteroSelectMenu(select);
    const trigger = triggerFor(menu);
    trigger.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    trigger.click();
    document.body.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(select.value).toBe('cartoon');
    menu.dispose();
  });

  it('only enhances Zotero compact controls and removes them on disposal', () => {
    const select = createSelect();
    const unrelated = document.createElement('select');
    document.body.append(unrelated);
    const dispose = initializeZoteroSelectMenus(document.body);
    expect(document.querySelectorAll('[role=combobox]')).toHaveLength(1);
    expect(unrelated.hidden).toBe(false);
    dispose();
    expect(document.querySelectorAll('[role=combobox]')).toHaveLength(0);
    expect(select.hidden).toBe(false);
  });
});
