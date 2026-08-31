// SPDX-License-Identifier: MPL-2.0
type Child = Node | string | null | undefined;

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: {
    className?: string;
    text?: string;
    title?: string;
  } = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className !== undefined) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title !== undefined) node.title = options.title;
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

export function button(
  label: string,
  options: { className?: string; title?: string } = {},
): HTMLButtonElement {
  const node = element('button', { text: label });
  if (options.className !== undefined) node.className = options.className;
  if (options.title !== undefined) node.title = options.title;
  node.type = 'button';
  return node;
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  node.hidden = hidden;
}
