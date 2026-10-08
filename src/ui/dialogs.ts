import { openDoc, resetView, type App } from '../app';
import { importCsv, type CsvImport, type Missing } from '../csv';
import { formatEffEnd } from '../effectivity';
import {
  addBom,
  addFamily,
  addItemType,
  BOM_TYPES,
  itemTypeUsage,
  migrateItemType,
  moveFamily,
  removeBom,
  removeFamily,
  removeItemType,
  renameFamily,
  renameItemType,
  setFamilyValues,
  setItemTypePrefix,
  sortedChildren,
  type Bom,
  type BomDocument,
  type BomType,
  type Relation,
} from '../model';
import { button, field, h, input } from './dom';

/**
 * Modal form; `onSubmit` runs only when confirmed. Without a field to type in, Enter confirms. `danger` fills the submit
 * button red. Returns the submit button; disabling it also stops Enter from confirming.
 */
function showFormDialog(title: string, submitLabel: string, fields: HTMLElement[], onSubmit: () => void, danger = false): HTMLButtonElement {
  const cancel = h('button', { type: 'button' }, 'Cancel');
  const submit = h('button', { className: danger ? 'primary danger' : 'primary' }, submitLabel);
  const form = h('form', { method: 'dialog' }, h('h2', {}, title), ...fields, h('div', { className: 'dialog-actions' }, cancel, submit));
  const dialog = h('dialog', {}, form);

  cancel.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', onSubmit);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  if (document.activeElement === cancel) submit.focus();
  return submit;
}

/** Asks to confirm a destructive action, with the confirm button in the danger color; Enter confirms, Escape cancels. */
export function showConfirmDialog(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
  showFormDialog(title, confirmLabel, [h('p', {}, message)], onConfirm, true);
}

const requiredText = () => h('input', { name: 'name', required: true, pattern: '.*\\S.*' });

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
    h('div', { className: 'dialog-actions' }, button({ type: 'button', className: 'primary' }, () => dialog.close(), 'Done')),
  );
  render();
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * Rows of an edit dialog in one grid, so the columns line up although the add row has no count or remove button: Add
 * spans the columns after the add fields. `className` sets the columns where the default does not fit.
 */
function listGrid(rows: HTMLElement[][], addFields: HTMLElement[], onAdd: () => void, className = ''): HTMLElement {
  const row = (cells: HTMLElement[]) => h('div', { className: 'list-row' }, ...cells);
  const add = button({ type: 'button', className: 'add' }, onAdd, 'Add');
  add.style.gridColumn = `${addFields.length + 1} / -1`;
  for (const el of addFields) {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && el instanceof HTMLInputElement) onAdd();
    });
  }
  return h('div', { className: `list-grid ${className}` }, ...rows.map(row), row([...addFields, add]));
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
      return [name, prefix, h('span', { className: 'muted' }, `${n} items`), remove];
    });
    const newName = h('input', { name: 'new-type', placeholder: 'New type' });
    const newPrefix = h('input', { name: 'new-prefix', ...PREFIX });
    const add = () => newName.value.trim() && update(() => addItemType(doc, newName.value, newPrefix.value));
    const grid = listGrid(rows, [newName, newPrefix], add);
    if (doc.itemTypes.length < 2) return [grid];

    const typeOptions = () => doc.itemTypes.map((t) => h('option', { value: t.name }, t.name));
    const from = h('select', { name: 'migrate-from', title: 'Type to migrate and remove' }, ...typeOptions());
    const to = h('select', { name: 'migrate-to', title: 'Type the items get' }, ...typeOptions());
    to.selectedIndex = 1;
    const migrate = () =>
      from.value !== to.value && showMigrateItemTypeDialog(app, from.value, to.value, () => update(() => migrateItemType(doc, from.value, to.value)));
    return [grid, h('div', { className: 'migrate-row' }, h('span', {}, 'Migrate'), from, h('span', {}, '→'), to, button({ type: 'button' }, migrate, 'Migrate'))];
  });
}

/** Confirms moving all items of one type to another, with how many will need a new ID number. */
function showMigrateItemTypeDialog(app: App, from: string, to: string, onConfirm: () => void): void {
  const doc = openDoc(app.state);
  const n = itemTypeUsage(doc, from);
  const renumbered = migrateItemType(structuredClone(doc), from, to); // dry run
  const prefix = doc.itemTypes.find((t) => t.name === to)!.prefix;
  const ids = prefix ? `get the ID prefix ${prefix}` : 'lose their ID prefix';
  showFormDialog(
    'Migrate item type',
    'Migrate',
    [
      h('p', {}, `${n} ${from} items become ${to} and ${ids}. The ${from} type is removed.`),
      h('p', {}, `Items whose new ID is already in use get the next free number instead: ${renumbered} of ${n}.`),
    ],
    onConfirm,
  );
}

/** BOM type picker; an empty choice only for BOMs from files written before types existed. */
function bomTypeSelect(name: string, value: BomType | undefined): HTMLSelectElement {
  const options = BOM_TYPES.map((t) => h('option', { value: t }, t));
  const select = h('select', { name, title: 'BOM type' }, ...(value ? [] : [h('option', { value: '' }, '—')]), ...options);
  select.value = value ?? '';
  return select;
}

export function showStructureTypesDialog(app: App): void {
  showEditDialog(app, 'Structure types', (update) => {
    const doc = openDoc(app.state);
    const { state } = app;
    const rows = doc.boms.map((bom, i) => {
      const label = bom.name || bom.id;
      const name = input(`bom-${i}-name`, bom.name, (v) => update(() => (bom.name = v || bom.name)), { title: 'BOM name' });
      const type = bomTypeSelect(`bom-${i}-type`, bom.type);
      type.addEventListener('change', () => update(() => (bom.type = (type.value as BomType) || undefined)));
      const remove = () => {
        const n = doc.alignments.filter((a) => a.source.startsWith(`${bom.id}:`) || a.target.startsWith(`${bom.id}:`)).length;
        const alignments = n ? ` Its ${n} alignments are removed too.` : '';
        showConfirmDialog('Remove BOM', `Remove ${label}?${alignments} Its items are kept.`, 'Remove', () =>
          update(() => {
            removeBom(doc, bom.id);
            if (state.bomId === bom.id) {
              state.bomId = doc.boms[0].id;
              resetView(state);
            }
            if (state.align?.bomId === bom.id) state.align = undefined;
          }),
        );
      };
      const single = doc.boms.length < 2;
      const removeButton = button({ className: 'icon danger', title: single ? 'The only BOM' : `Remove ${label}`, disabled: single }, remove, '✕');
      return [name, type, h('span', { className: 'muted' }, `${bom.relations.length} relations`), removeButton];
    });
    const newName = h('input', { name: 'new-bom', placeholder: 'New BOM' });
    const newType = bomTypeSelect('new-bom-type', BOM_TYPES[0]);
    const add = () => newName.value.trim() && update(() => addBom(doc, newName.value.trim(), newType.value as BomType));
    return [listGrid(rows, [newName, newType], add)];
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
            const renames = setFamilyValues(doc, f.name, v.split(','));
            const selected = ctx.options[f.name];
            if (selected !== undefined && renames.has(selected)) ctx.options[f.name] = renames.get(selected);
            if (!f.values.includes(ctx.options[f.name] ?? '')) delete ctx.options[f.name];
          }),
        { className: 'mono', title: 'Comma-separated values' },
      );
      const remove = () =>
        update(() => {
          removeFamily(doc, f.name);
          delete ctx.options[f.name];
        });
      // Named by family, so focus follows the family as it moves.
      const move = (step: -1 | 1, label: string, glyph: string) =>
        button(
          { name: `fam-move-${step}-${f.name}`, className: 'icon', title: `Move ${f.name} ${label}`, disabled: !doc.families[i + step] },
          () => update(() => moveFamily(doc, f.name, step)),
          glyph,
        );
      return [name, values, move(-1, 'up', '↑'), move(1, 'down', '↓'), button({ className: 'icon danger', title: `Remove ${f.name}` }, remove, '✕')];
    });
    const newName = h('input', { name: 'new-family', className: 'mono', placeholder: 'New family' });
    const newValues = h('input', { name: 'new-values', className: 'mono', placeholder: 'Values, comma-separated' });
    const add = () => newName.value.trim() && update(() => addFamily(doc, newName.value.trim(), newValues.value.split(',')));
    return [
      listGrid(rows, [newName, newValues], add, 'family-grid'),
      h(
        'p',
        { className: 'muted' },
        'Renaming a family or value (in place, keeping the number of values) updates the expressions that use it. Names may contain spaces; expressions write them in double quotes.',
      ),
    ];
  });
}

/**
 * Preview of a CSV import (see importCsv): the new BOM's name and type, the item types and variant values it lacks
 * (created when the box is checked), what it adds and its structure, or the problems found, with Create disabled.
 * Nothing changes until Create, which is one undo step.
 */
export function showImportCsvDialog(app: App, fileName: string, text: string): void {
  const baseName = fileName.replace(/\.[^.]*$/, '');
  const name = requiredText();
  name.value = baseName;
  const type = bomTypeSelect('type', BOM_TYPES[0]);
  const createMissing = h('input', { type: 'checkbox', name: 'create-missing', checked: true });
  const body = h('div', {});
  let result: CsvImport | undefined;
  const render = () => {
    const doc = openDoc(app.state);
    result = importCsv(doc, text, baseName, createMissing.checked);
    submit.disabled = 'errors' in result;
    body.replaceChildren(...missingList(doc, result.missing, createMissing), ...importSummary(doc, result));
  };
  createMissing.addEventListener('change', render);
  const fields = [h('div', { className: 'import-fields' }, field('BOM name', name), field('Type', type)), body];
  const submit = showFormDialog(`Import ${fileName}`, 'Create', fields, () => {
    if (!result || 'errors' in result) return;
    const { doc, bom } = result;
    app.tryCommit(() => {
      Object.assign(bom, { name: name.value.trim(), type: type.value as BomType });
      app.state.doc = doc;
      app.state.bomId = bom.id;
      resetView(app.state);
      app.toast(`Imported ${bom.relations.length} relations into ${bom.name}`);
    });
  });
  render();
}

/** The checkbox and what it creates; nothing when the document has every type and value the CSV uses. */
function missingList(doc: BomDocument, { types, values }: Missing, checkbox: HTMLInputElement): HTMLElement[] {
  if (!types.length && !values.size) return [];
  const lines = [
    ...types.map((t) => `Item type ${t.name}${t.prefix ? `, ID prefix ${t.prefix}` : ''}`),
    ...[...values].map(([f, vs]) => `${doc.families.some((x) => x.name === f) ? 'Values of' : 'Variant family'} ${f}: ${vs.join(', ')}`),
  ];
  return [h('label', { className: 'check' }, checkbox, 'Create missing item types and variant values'), h('ul', { className: 'muted import-missing' }, ...lines.map((l) => h('li', {}, l)))];
}

/** Counts and the structure tree, or the problems. */
function importSummary(before: BomDocument, result: CsvImport): HTMLElement[] {
  if ('errors' in result) {
    const { errors } = result;
    const summary = h('p', {}, `${errors.length === 1 ? '1 problem' : `${errors.length} problems`}; fix the CSV and import it again.`);
    return [summary, h('div', { className: 'import-preview' }, h('ul', { className: 'errors' }, ...errors.map((e) => h('li', {}, e))))];
  }
  const { doc, bom, reused } = result;
  const added = doc.items.size - before.items.size;
  return [h('p', {}, `${bom.relations.length} relations · ${added} new items · ${reused.size} reused`), importPreview(doc, bom, reused)];
}

/** Read-only indented tree of the imported BOM, with items already in the document marked as reused. */
function importPreview(doc: BomDocument, bom: Bom, reused: Set<string>): HTMLElement {
  const rows: HTMLElement[] = [];
  const addRow = (itemId: string, rel: Relation | undefined, depth: number) => {
    const item = doc.items.get(itemId)!;
    const name = h('td', {}, item.name);
    name.style.paddingLeft = `${10 + depth * 16}px`;
    const cell = (text: string, className = '') => h('td', { className }, text);
    rows.push(
      h(
        'tr',
        { className: `st-included${rows.length % 2 ? ' band' : ''}` },
        name,
        cell(item.id),
        cell(rel ? String(rel.qty) : '', 'num'),
        cell(rel?.findNo ?? '', 'num'),
        cell(rel?.variantExpr ?? '', 'expr'),
        cell(rel ? formatEffEnd(rel.eff, 'from') : '', 'eff'),
        cell(rel ? formatEffEnd(rel.eff, 'to') : '', 'eff'),
        cell(reused.has(itemId) ? 'reused' : '', 'muted'),
      ),
    );
    for (const r of sortedChildren(bom, itemId)) addRow(r.childId, r, depth + 1);
  };
  addRow(bom.rootId, undefined, 0);
  const head = ['Name', 'ID', 'Qty', 'Find no.', 'Variant', 'Eff. from', 'Eff. to', ''].map((t) => h('th', {}, t));
  return h('div', { className: 'import-preview' }, h('table', { className: 'tree-table' }, h('thead', {}, h('tr', {}, ...head)), h('tbody', {}, ...rows)));
}

/** Asks whether to save unsaved changes first. `onChoice` is not called on Cancel or Escape. */
export function showUnsavedChangesDialog(fileName: string, onChoice: (save: boolean) => void): void {
  const choice = (value: string, label: string, className = '') => h('button', { value, className }, label);
  const save = choice('save', 'Save', 'primary');
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
