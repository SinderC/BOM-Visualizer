import { openDoc, type App } from '../app';
import {
  addFamily,
  addItemType,
  BOM_TYPES,
  itemTypeUsage,
  removeFamily,
  removeItemType,
  renameFamily,
  renameItemType,
  setFamilyValues,
  setItemTypePrefix,
  type BomType,
} from '../model';
import { button, field, h, input } from './dom';

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
  showFormDialog('Create new BOM', 'Create', [field('Name', name), field('Type', type)], () =>
    onCreate(name.value.trim(), type.value as BomType),
  );
}

const PREFIX = { className: 'mono prefix', placeholder: 'ID prefix', pattern: '\\s*\\S*\\s*', title: 'Optional start of the IDs of items of this type' };

/** Asks for the name and optional ID prefix of a new item type. */
export function showNewItemTypeDialog(onCreate: (name: string, prefix: string) => void): void {
  const name = requiredText();
  const prefix = h('input', { name: 'prefix', ...PREFIX });
  showFormDialog('Add item type', 'Add', [field('Name', name), field('ID prefix (optional)', prefix)], () => onCreate(name.value, prefix.value));
}

/**
 * Modal for editing document lists in place. `content` builds the dialog body and is called again after each change;
 * changes commit right away, so each one is an undo step.
 */
function showEditDialog(app: App, title: string, content: (update: (mutate: () => void) => void) => HTMLElement[]): void {
  const body = h('div', {});
  const render = () => {
    const focused = (document.activeElement as HTMLInputElement | null)?.name;
    body.replaceChildren(...content(update));
    if (focused) body.querySelector<HTMLElement>(`[name="${CSS.escape(focused)}"]`)?.focus();
  };
  const update = (mutate: () => void) => {
    app.tryCommit(mutate);
    // Deferred like the app's render, so that focus has moved (e.g. Tab after a change event) first.
    setTimeout(render);
  };
  const dialog = h(
    'dialog',
    {},
    h('h2', {}, title),
    body,
    h('div', { className: 'dialog-actions' }, button({ type: 'button' }, () => dialog.close(), 'Done')),
  );
  render();
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

export function showItemTypesDialog(app: App): void {
  showEditDialog(app, 'Item types', (update) => {
    const doc = openDoc(app.state);
    const rows = doc.itemTypes.map((t, i) => {
      const n = itemTypeUsage(doc, t.name);
      const name = input(`type-${i}-name`, t.name, (v) => update(() => renameItemType(doc, t.name, v)), { title: 'Type name' });
      const prefix = input(`type-${i}-prefix`, t.prefix, (v) => update(() => setItemTypePrefix(doc, t.name, v)), {
        ...PREFIX,
        title: 'Start of the IDs of items of this type; changing it renames their IDs',
      });
      const title = n ? `Used by ${n} items` : `Remove ${t.name}`;
      const remove = button({ className: 'icon danger', title, disabled: n > 0 }, () => update(() => removeItemType(doc, t.name)), '✕');
      return h('div', { className: 'type-row' }, name, prefix, h('span', { className: 'muted' }, `${n} items`), remove);
    });
    const newName = h('input', { name: 'new-type', placeholder: 'New type' });
    const newPrefix = h('input', { name: 'new-prefix', ...PREFIX });
    const add = () => newName.value.trim() && update(() => addItemType(doc, newName.value, newPrefix.value));
    for (const el of [newName, newPrefix]) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') add();
      });
    }
    return [...rows, h('div', { className: 'type-row' }, newName, newPrefix, button({ type: 'button' }, add, 'Add'))];
  });
}

export function showVariantFamiliesDialog(app: App): void {
  showEditDialog(app, 'Variant families', (update) => {
    const doc = openDoc(app.state);
    const { ctx } = app.state;
    const rows = doc.families.map((f, i) => {
      const name = input(
        `fam-${i}-name`,
        f.name,
        (v) =>
          update(() => {
            const oldName = f.name;
            renameFamily(doc, oldName, v);
            ctx.options[v] = ctx.options[oldName];
            if (v !== oldName) delete ctx.options[oldName];
          }),
        { className: 'mono', title: 'Family name' },
      );
      const values = input(
        `fam-${i}-values`,
        f.values.join(', '),
        (v) =>
          update(() => {
            setFamilyValues(doc, f.name, v.split(','));
            if (!f.values.includes(ctx.options[f.name] ?? '')) delete ctx.options[f.name];
          }),
        { className: 'mono', title: 'Comma-separated values' },
      );
      const remove = () =>
        update(() => {
          removeFamily(doc, f.name);
          delete ctx.options[f.name];
        });
      return h('div', { className: 'family-row' }, name, values, button({ className: 'icon danger', title: `Remove ${f.name}` }, remove, '✕'));
    });
    return [
      ...rows,
      button({ type: 'button' }, () => update(() => addFamily(doc)), '+ Add family'),
      h('p', { className: 'muted' }, 'Renaming a family does not rewrite existing expressions; they will show as invalid.'),
    ];
  });
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
