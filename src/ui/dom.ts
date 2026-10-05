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

/** Rejects impossible dates such as 2026-02-30, which Date rolls over into March. */
const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

const CALENDAR_ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.4"/></svg>';

/**
 * Date field that shows and takes yyyy-mm-dd in every browser: native date inputs use the browser's display language
 * (MM/DD/YYYY for US English). The button opens the browser's own calendar from a hidden date input. Commits '' or a
 * valid date; anything else is outlined and not committed.
 */
export function dateField(name: string, value: string | undefined, onCommit: (v: string) => void): HTMLElement {
  const text = input(
    name,
    value,
    (v) => {
      const valid = !v || isIsoDate(v);
      text.setCustomValidity(valid ? '' : 'Use yyyy-mm-dd');
      if (valid) onCommit(v);
    },
    { placeholder: 'yyyy-mm-dd', className: 'mono', spellcheck: false },
  );
  const picker = h('input', { type: 'date', className: 'date-picker', tabIndex: -1 });
  picker.setAttribute('aria-hidden', 'true');
  picker.addEventListener('change', () => {
    text.value = picker.value;
    text.dispatchEvent(new Event('change'));
  });
  const open = button({ type: 'button', className: 'icon', title: 'Pick a date' }, () => {
    picker.value = isIsoDate(text.value) ? text.value : '';
    picker.showPicker();
  });
  open.innerHTML = CALENDAR_ICON;
  return h('div', { className: 'date-input' }, text, open, picker);
}

export const field = (label: string, control: HTMLElement) => h('label', {}, label, control);
