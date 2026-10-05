import { complete, type Completion } from '../expr';
import type { OptionFamily } from '../model';
import { h } from './dom';

let lists = 0;

/**
 * Suggests families, operators, values and AND/OR while a variant expression is typed in `field`. Attach it before the
 * field's own keydown handlers: while the list is open, it takes ↑/↓, Enter, Tab and Escape.
 */
export function attachExprCompletion(field: HTMLInputElement | HTMLTextAreaElement, families: () => OptionFamily[]): void {
  const id = `completions-${lists++}`;
  // In the top layer, so the editor panel or tree-table does not clip it; added to the page only while shown.
  const list = h('div', { id, className: 'menu-list completions', popover: 'manual', role: 'listbox' });
  let current: Completion = { from: 0, to: 0, items: [] };
  let active = 0;
  field.setAttribute('role', 'combobox');
  field.setAttribute('aria-autocomplete', 'list');
  field.setAttribute('aria-controls', id);
  field.setAttribute('aria-expanded', 'false');
  const events: HTMLElement = field; // one event map for both field types

  const onScroll = (e: Event) => e.target !== list && e.target !== field && hide();
  const hide = () => {
    if (!list.isConnected) return;
    list.hidePopover();
    list.remove();
    field.setAttribute('aria-expanded', 'false');
    field.removeAttribute('aria-activedescendant');
    removeEventListener('scroll', onScroll, true);
    removeEventListener('resize', hide);
  };

  const highlight = (i: number) => {
    active = i;
    [...list.children].forEach((el, j) => el.classList.toggle('active', j === i));
    field.setAttribute('aria-activedescendant', `${id}-${i}`);
    list.children[i]?.scrollIntoView({ block: 'nearest' });
  };

  const accept = (i: number) => {
    field.setSelectionRange(current.from, current.to);
    // Typed as if by the user, so the field's own undo includes it; fires `input`, which shows what can follow.
    if (document.execCommand('insertText', false, current.items[i])) return;
    field.setRangeText(current.items[i], current.from, current.to, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const show = () => {
    current = complete(field.value, field.selectionStart ?? field.value.length, families());
    if (!current.items.length || document.activeElement !== field) return hide();
    list.replaceChildren(
      ...current.items.map((item, i) => {
        const option = h('button', { type: 'button', id: `${id}-${i}`, role: 'option', tabIndex: -1 }, item.trim());
        option.addEventListener('mousedown', (e) => e.preventDefault()); // keeps focus in the field
        option.addEventListener('click', () => accept(i));
        return option;
      }),
    );
    if (!list.isConnected) {
      document.body.append(list);
      list.showPopover();
      addEventListener('scroll', onScroll, true); // capture: any scrolling container moves the field
      addEventListener('resize', hide);
    }
    // Below the field, or above it when there is no room below.
    const r = field.getBoundingClientRect();
    const fitsBelow = r.bottom + 2 + list.offsetHeight <= innerHeight;
    list.style.left = `${r.left}px`;
    list.style.top = `${fitsBelow ? r.bottom + 2 : r.top - 2 - list.offsetHeight}px`;
    field.setAttribute('aria-expanded', 'true');
    highlight(0);
  };

  events.addEventListener('keydown', (e) => {
    if (!list.isConnected || e.isComposing || e.altKey || e.ctrlKey || e.metaKey || (e.key === 'Tab' && e.shiftKey)) return;
    const n = current.items.length;
    const actions: Record<string, () => void> = {
      ArrowDown: () => highlight((active + 1) % n),
      ArrowUp: () => highlight((active - 1 + n) % n),
      Enter: () => accept(active),
      Tab: () => accept(active),
      Escape: hide,
    };
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    action();
  });
  events.addEventListener('keyup', (e) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && show());
  events.addEventListener('input', show);
  events.addEventListener('focus', show);
  events.addEventListener('click', show);
  events.addEventListener('blur', hide);
}
