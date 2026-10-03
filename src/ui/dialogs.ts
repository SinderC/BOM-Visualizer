import { h } from '../app';
import { BOM_TYPES, type BomType } from '../model';

/** Modal form; `onSubmit` runs only when confirmed. */
function showFormDialog(title: string, submitLabel: string, fields: HTMLElement[], onSubmit: () => void): void {
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const form = h(
    'form',
    { method: 'dialog' },
    h('h2', {}, title),
    ...fields,
    h('div', { className: 'dialog-actions' }, cancel, h('button', {}, submitLabel)),
  );
  const dialog = h('dialog', {}, form);

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', onSubmit);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

const requiredText = () => h('input', { name: 'name', required: true, pattern: '.*\\S.*' });

/** Asks for a new BOM's name and type. */
export function showNewBomDialog(onCreate: (name: string, type: BomType) => void): void {
  const name = requiredText();
  const type = h('select', { name: 'type' }, ...BOM_TYPES.map((t) => h('option', { value: t }, t)));
  showFormDialog('Create new BOM', 'Create', [h('label', {}, 'Name', name), h('label', {}, 'Type', type)], () =>
    onCreate(name.value.trim(), type.value as BomType),
  );
}

/** Asks for the name of a new item type. */
export function showNewItemTypeDialog(onCreate: (name: string) => void): void {
  const name = requiredText();
  showFormDialog('Add item type', 'Add', [h('label', {}, 'Name', name)], () => onCreate(name.value));
}

/** Asks whether to save unsaved changes first. `onChoice` is not called on Cancel or Escape. */
export function showUnsavedChangesDialog(fileName: string, onChoice: (save: boolean) => void): void {
  const choice = (value: string, label: string) => h('button', { value }, label);
  const save = choice('save', 'Save');
  const dialog = h(
    'dialog',
    {},
    h(
      'form',
      { method: 'dialog' },
      h('h2', {}, 'Save changes?'),
      h('p', {}, `${fileName} has changes that are not saved to file.`),
      h('div', { className: 'dialog-actions' }, choice('discard', "Don't save"), choice('cancel', 'Cancel'), save),
    ),
  );
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (dialog.returnValue === 'save' || dialog.returnValue === 'discard') onChoice(dialog.returnValue === 'save');
  });
  document.body.append(dialog);
  dialog.showModal();
  save.focus();
}
