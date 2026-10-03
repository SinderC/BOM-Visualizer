import { h } from '../app';
import { BOM_TYPES, type BomType } from '../model';

/** Modal asking for a new BOM's name and type. Calls `onCreate` only when confirmed. */
export function showNewBomDialog(onCreate: (name: string, type: BomType) => void): void {
  const name = h('input', { name: 'name', required: true, pattern: '.*\\S.*' });
  const type = h('select', { name: 'type' }, ...BOM_TYPES.map((t) => h('option', { value: t }, t)));
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const form = h(
    'form',
    { method: 'dialog' },
    h('h2', {}, 'Create new BOM'),
    h('label', {}, 'Name', name),
    h('label', {}, 'Type', type),
    h('div', { className: 'dialog-actions' }, cancel, h('button', {}, 'Create')),
  );
  const dialog = h('dialog', {}, form);

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', () => onCreate(name.value.trim(), type.value as BomType));
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
