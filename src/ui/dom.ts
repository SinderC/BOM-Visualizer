type Props<K extends keyof HTMLElementTagNameMap> = Partial<Omit<HTMLElementTagNameMap[K], 'dataset'>> & {
  dataset?: Record<string, string>;
};

/** Creates an element with properties and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { dataset, ...rest } = props;
  Object.assign(el, rest);
  if (dataset) Object.assign(el.dataset, dataset);
  el.append(...children);
  return el;
}

export function button(props: Props<'button'>, onClick: () => void, ...children: (Node | string)[]): HTMLButtonElement {
  const b = h('button', props, ...children);
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Input that commits its trimmed value on `change` (blur/enter), so typing never re-renders mid-edit. `name` lets
 * focus be restored after a re-render.
 */
export function input(
  name: string,
  value: string | number | undefined,
  onCommit: (v: string) => void,
  props: Props<'input'> = {},
): HTMLInputElement {
  const el = h('input', { name, type: 'text', ...props, value: value?.toString() ?? '' });
  el.addEventListener('change', () => onCommit(el.value.trim()));
  return el;
}

export const field = (label: string, control: HTMLElement) => h('label', {}, label, control);
