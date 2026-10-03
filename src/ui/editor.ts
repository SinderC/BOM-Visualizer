import { activeBom, h, type App } from '../app';
import { validate } from '../expr';
import {
  addItem,
  addItemType,
  addRelation,
  DEFAULT_ITEM_TYPES,
  occurrencePath,
  removeRelation,
  renameItem,
  updateItem,
  updateRelation,
  type Relation,
} from '../model';
import type { Occurrence } from '../resolve';
import { showNewItemTypeDialog } from './dialogs';

const STATUS_TEXT: Record<Occurrence['status'], string> = {
  included: 'Included',
  excludedByVariant: 'Excluded by variant',
  excludedByEff: 'Excluded by effectivity',
  excludedByParent: 'Excluded (parent excluded)',
};

/** Input that commits on `change` (blur/enter), so typing never re-renders mid-edit. */
function input(name: string, value: string | number | undefined, onCommit: (v: string) => void, type = 'text'): HTMLInputElement {
  const el = h('input', { name, type, value: value?.toString() ?? '' });
  el.addEventListener('change', () => onCommit(el.value.trim()));
  return el;
}

const field = (label: string, control: HTMLElement) => h('label', {}, label, control);
const optNumber = (v: string) => (v === '' ? undefined : Number(v));
const NEW_TYPE = '\0new'; // select value of the "New type…" entry; cannot clash with a real type name

/** Item type picker with a "New type…" entry that adds a type to the document via a dialog. */
function typeSelect(app: App, name: string, value: string | undefined, onPick: (type: string | undefined) => void): HTMLSelectElement {
  const { doc } = app.state;
  const select = h(
    'select',
    { name },
    h('option', { value: '' }, '—'),
    ...doc.itemTypes.map((t) => h('option', { value: t }, t)),
    h('option', { value: NEW_TYPE }, 'New type…'),
  );
  select.value = value ?? '';
  select.addEventListener('change', () => {
    if (select.value !== NEW_TYPE) return app.commit(() => onPick(select.value || undefined));
    select.value = value ?? ''; // stays correct if the dialog is cancelled
    showNewItemTypeDialog((type) => app.commit(() => onPick(addItemType(doc, type))));
  });
  return select;
}

/** Type for new children; remembered across renders so consecutive adds keep the last choice. */
let addChildType: string | undefined = DEFAULT_ITEM_TYPES[0];

export function renderEditor(container: HTMLElement, app: App): void {
  const occ = app.occurrence(app.state.selected);
  if (!occ) {
    container.replaceChildren(h('h2', {}, 'Editor'), h('p', { className: 'muted' }, 'Select a node in the tree.'));
    return;
  }
  container.replaceChildren(
    h('h2', {}, occ.item.name),
    h('p', { className: 'mono muted', title: 'Occurrence address' }, occ.address),
    ...(app.state.ctx.enabled ? [h('p', { className: `status st-${occ.status}` }, occ.reason ?? STATUS_TEXT[occ.status])] : []),
    ...itemSection(app, occ),
    ...(occ.relation ? relationSection(app, occ.relation) : []),
    ...structureSection(app, occ),
  );
}

function itemSection(app: App, occ: Occurrence): HTMLElement[] {
  const { doc } = app.state;
  const item = occ.item;
  const uses = doc.boms.flatMap((b) => b.relations).filter((r) => r.childId === item.id).length;
  const description = h('textarea', { name: 'item-desc', value: item.description, rows: 2 });
  description.addEventListener('change', () => app.commit(() => updateItem(doc, item.id, { description: description.value })));

  const id = input('item-id', item.id, (v) => {
    try {
      app.commit(() => renameItem(doc, item.id, v));
    } catch (e) {
      app.toast((e as Error).message, true);
      app.commit(); // restore the old id in the field
    }
  });

  const type = typeSelect(app, 'item-type', item.type, (t) => updateItem(doc, item.id, { type: t }));

  return [
    h('h3', {}, 'Item'),
    h('div', { className: 'row' }, field('Id', id), field('Type', type)),
    field('Name', input('item-name', item.name, (v) => app.commit(() => updateItem(doc, item.id, { name: v || item.name })))),
    field('Description', description),
    h('p', { className: 'muted' }, `Used by ${uses} relation${uses === 1 ? '' : 's'} across all BOMs; item edits apply everywhere.`),
  ];
}

function relationSection(app: App, rel: Relation): HTMLElement[] {
  const bom = activeBom(app.state);
  const set = (patch: Partial<Relation>) => app.commit(() => updateRelation(bom, rel.id, patch));
  const setEff = (patch: Partial<Relation['eff']>) => set({ eff: { ...rel.eff, ...patch } });

  const expr = h('textarea', { name: 'rel-variant', value: rel.variantExpr, rows: 3, className: 'mono', spellcheck: false });
  const errors = h('ul', { className: 'errors' });
  const showErrors = () =>
    errors.replaceChildren(
      ...validate(expr.value, app.state.doc.families).map((e) => h('li', {}, `col ${e.pos + 1}: ${e.message}`)),
    );
  showErrors();
  expr.addEventListener('input', showErrors);
  expr.addEventListener('change', () => set({ variantExpr: expr.value.trim() }));

  return [
    h('h3', {}, `Relation ${rel.id}`, h('span', { className: 'muted' }, ` (parent ${rel.parentId})`)),
    h(
      'div',
      { className: 'row' },
      field('Qty', input('rel-qty', rel.qty, (v) => set({ qty: Number(v) || rel.qty }), 'number')),
      field('Find no', input('rel-find', rel.findNo, (v) => set({ findNo: v }))),
    ),
    field('Variant expression', expr),
    errors,
    h('p', { className: 'muted hint' }, 'e.g. ENGINE=V8 AND (MARKET=EU OR TRIM IN (BASE, SPORT)). Blank = always.'),
    h(
      'div',
      { className: 'row' },
      field('Date from', input('eff-df', rel.eff.dateFrom, (v) => setEff({ dateFrom: v || undefined }), 'date')),
      field('Date to', input('eff-dt', rel.eff.dateTo, (v) => setEff({ dateTo: v || undefined }), 'date')),
    ),
    h(
      'div',
      { className: 'row' },
      field('Unit from', input('eff-uf', rel.eff.unitFrom, (v) => setEff({ unitFrom: optNumber(v) }), 'number')),
      field('Unit to', Object.assign(input('eff-ut', rel.eff.unitTo, (v) => setEff({ unitTo: optNumber(v) }), 'number'), { placeholder: 'UP' })),
    ),
  ];
}

function structureSection(app: App, occ: Occurrence): HTMLElement[] {
  const { doc, collapsed } = app.state;
  const bom = activeBom(app.state);

  const existing = h(
    'select',
    { name: 'add-existing' },
    h('option', { value: '' }, '— new item —'),
    ...[...doc.items.values()].map((i) => h('option', { value: i.id }, `${i.id} ${i.name}`)),
  );
  const name = h('input', { name: 'add-name', placeholder: 'New item name' });
  if (addChildType && !doc.itemTypes.includes(addChildType)) addChildType = undefined;
  const type = typeSelect(app, 'add-type', addChildType, (t) => (addChildType = t));
  type.title = 'Type of the new item; also sets its id prefix';
  existing.addEventListener('change', () => (name.disabled = type.disabled = !!existing.value));
  const add = h('button', {}, 'Add child');
  add.addEventListener('click', () => {
    try {
      app.commit(() => {
        const childId = existing.value || addItem(doc, name.value.trim() || 'New item', '', addChildType).id;
        const rel = addRelation(doc, bom, occ.item.id, childId);
        collapsed.delete(occ.address);
        app.state.selected = occurrencePath(bom.id, [...occ.path, rel.id]);
      });
    } catch (e) {
      app.toast((e as Error).message, true);
    }
  });

  const out: HTMLElement[] = [h('h3', {}, 'Structure'), h('div', { className: 'row' }, existing), h('div', { className: 'row' }, name, type), add];
  if (occ.relation) {
    const relId = occ.relation.id;
    const remove = h('button', { className: 'danger' }, 'Remove from parent');
    remove.addEventListener('click', () =>
      app.commit(() => {
        removeRelation(bom, relId);
        app.state.selected = occurrencePath(bom.id, occ.path.slice(0, -1));
      }),
    );
    out.push(remove);
  }
  return out;
}
