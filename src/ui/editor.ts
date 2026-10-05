import { activeBom, openDoc, type App } from '../app';
import { validate } from '../expr';
import {
  addItem,
  addItemType,
  addRelation,
  DEFAULT_ITEM_TYPES,
  lockedIdPrefix,
  occurrencePath,
  parentAddress,
  parseQty,
  parseUnit,
  removeRelation,
  renameItem,
  setItemType,
  updateItem,
  updateRelation,
  usageCount,
  type Relation,
} from '../model';
import type { Occurrence, Status } from '../resolve';
import { showNewItemTypeDialog } from './dialogs';
import { button, field, h, input } from './dom';

const STATUS_TEXT: Record<Status, string> = {
  included: 'Included',
  excludedByVariant: 'Excluded by variant',
  excludedByEff: 'Excluded by effectivity',
  excludedByParent: 'Excluded (parent excluded)',
};

/** Codes and numbers in Geist Mono, matching the tree-table. */
const MONO = { className: 'mono' };
const UNIT = { type: 'number', min: '1', step: '1' };
const NEW_TYPE = '\0new'; // select value of the "New type…" entry; cannot clash with a real type name
const MIXED = '\0mixed'; // select value shown while selected items have different types

/**
 * Item type picker with a "New type…" entry that adds a type to the document via a dialog.
 * With `mixed`, it shows "— mixed —" until a type is picked.
 */
export function typeSelect(
  app: App,
  name: string,
  value: string | undefined,
  onPick: (type: string | undefined) => void,
  mixed = false,
): HTMLSelectElement {
  const doc = openDoc(app.state);
  const select = h(
    'select',
    { name },
    ...(mixed ? [h('option', { value: MIXED, disabled: true }, '— mixed —')] : []),
    h('option', { value: '' }, '—'),
    ...doc.itemTypes.map((t) => h('option', { value: t.name }, t.name)),
    h('option', { value: NEW_TYPE }, 'New type…'),
  );
  const initial = mixed ? MIXED : (value ?? '');
  select.value = initial;
  select.addEventListener('change', () => {
    if (select.value !== NEW_TYPE) return app.commit(() => onPick(select.value || undefined));
    select.value = initial; // stays correct if the dialog is cancelled
    showNewItemTypeDialog((type, prefix) => app.tryCommit(() => onPick(addItemType(doc, type, prefix))));
  });
  return select;
}

/** Type for new children; remembered across renders so consecutive adds keep the last choice. */
let addChildType: string | undefined = DEFAULT_ITEM_TYPES[0].name;

export function renderEditor(container: HTMLElement, app: App): void {
  const occ = app.occurrence(app.state.selected);
  if (!occ) {
    container.replaceChildren(h('h2', {}, 'Editor'), h('p', { className: 'muted' }, 'Select a node in the tree.'));
    return;
  }
  if (app.state.extraSelected.length) return container.replaceChildren(...multiSection(app, occ));
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
  const doc = openDoc(app.state);
  const item = occ.item;
  const uses = usageCount(doc, item.id);
  const description = h('textarea', { name: 'item-desc', value: item.description, rows: 2 });
  description.addEventListener('change', () => app.commit(() => updateItem(doc, item.id, { description: description.value })));

  // The type's prefix is shown beside the field and only the rest of the id is editable.
  const prefix = lockedIdPrefix(doc, item);
  const id = input('item-id', item.id.slice(prefix.length), (v) => app.tryCommit(() => renameItem(doc, item.id, prefix + v)), MONO);
  const idControl = prefix ? h('div', { className: 'id-input' }, h('span', { className: 'mono muted' }, prefix), id) : id;

  const type = typeSelect(app, 'item-type', item.type, (t) => setItemType(doc, item.id, t));

  return [
    h('h3', {}, 'Item'),
    h('div', { className: 'row' }, field('ID', idControl), field('Type', type)),
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
      ...validate(expr.value, openDoc(app.state).families).map((e) => h('li', {}, `col ${e.pos + 1}: ${e.message}`)),
    );
  showErrors();
  expr.addEventListener('input', showErrors);
  expr.addEventListener('change', () => set({ variantExpr: expr.value.trim() }));

  return [
    h('h3', {}, `Relation ${rel.id}`, h('span', { className: 'muted' }, ` (parent ${rel.parentId})`)),
    h(
      'div',
      { className: 'row' },
      field('Qty', input('rel-qty', rel.qty, (v) => set({ qty: parseQty(v, rel.qty) }), { ...MONO, type: 'number' })),
      field('Find no.', input('rel-find', rel.findNo, (v) => set({ findNo: v }), MONO)),
    ),
    field('Variant expression', expr),
    errors,
    h('p', { className: 'muted hint' }, 'e.g. ENGINE=V8 AND (MARKET=EU OR TRIM IN (BASE, SPORT)). Blank = always.'),
    h(
      'div',
      { className: 'row' },
      field('Date from', input('eff-df', rel.eff.dateFrom, (v) => setEff({ dateFrom: v || undefined }), { type: 'date' })),
      field('Date to', input('eff-dt', rel.eff.dateTo, (v) => setEff({ dateTo: v || undefined }), { type: 'date' })),
    ),
    h(
      'div',
      { className: 'row' },
      field('Unit from', input('eff-uf', rel.eff.unitFrom, (v) => setEff({ unitFrom: parseUnit(v, rel.eff.unitFrom) }), UNIT)),
      field(
        'Unit to',
        input('eff-ut', rel.eff.unitTo, (v) => setEff({ unitTo: parseUnit(v, rel.eff.unitTo) }), { ...UNIT, placeholder: 'UP' }),
      ),
    ),
  ];
}

/** Edits for several selected rows: the type of their items, and removing them from their parents. */
function multiSection(app: App, focused: Occurrence): HTMLElement[] {
  const doc = openDoc(app.state);
  const occs = [focused, ...app.state.extraSelected.map((a) => app.occurrence(a)!)];
  const itemIds = [...new Set(occs.map((o) => o.item.id))];
  const relIds = [...new Set(occs.flatMap((o) => (o.relation ? [o.relation.id] : [])))];
  const types = new Set(itemIds.map((id) => doc.items.get(id)!.type));

  // Items, not ids: an id changes with the type prefix.
  const items = itemIds.map((id) => doc.items.get(id)!);
  const type = typeSelect(app, 'multi-type', [...types][0], (t) => items.forEach((i) => setItemType(doc, i.id, t)), types.size > 1);

  const out: HTMLElement[] = [
    h('h2', {}, `${occs.length} rows selected`),
    h('p', { className: 'muted' }, `${itemIds.length} item${itemIds.length === 1 ? '' : 's'}; item edits apply everywhere.`),
    h('h3', {}, 'Item'),
    field('Type', type),
  ];
  if (relIds.length) {
    const remove = () =>
      app.commit(() => {
        const bom = activeBom(app.state);
        relIds.forEach((id) => removeRelation(doc, bom, id));
        app.state.selected = focused.relation ? parentAddress(focused.address) : focused.address;
        app.state.extraSelected = [];
      });
    out.push(h('h3', {}, 'Structure'), button({ className: 'danger' }, remove, 'Remove from parent'));
  }
  return out;
}

function structureSection(app: App, occ: Occurrence): HTMLElement[] {
  const doc = openDoc(app.state);
  const { collapsed } = app.state;
  const bom = activeBom(app.state);

  const existing = h(
    'select',
    { name: 'add-existing' },
    h('option', { value: '' }, '— new item —'),
    ...[...doc.items.values()].map((i) => h('option', { value: i.id }, `${i.id} ${i.name}`)),
  );
  const name = h('input', { name: 'add-name', placeholder: 'New item name' });
  if (addChildType && !doc.itemTypes.some((t) => t.name === addChildType)) addChildType = undefined;
  const type = typeSelect(app, 'add-type', addChildType, (t) => (addChildType = t));
  type.title = 'Type of the new item; also sets its ID prefix';
  existing.addEventListener('change', () => (name.disabled = type.disabled = !!existing.value));
  const add = button(
    {},
    () =>
      app.tryCommit(() => {
        const childId = existing.value || addItem(doc, name.value.trim() || 'New item', '', addChildType).id;
        const rel = addRelation(doc, bom, occ.item.id, childId);
        collapsed.delete(occ.address);
        app.state.selected = occurrencePath(bom.id, [...occ.path, rel.id]);
      }),
    'Add child',
  );

  const out: HTMLElement[] = [h('h3', {}, 'Structure'), h('div', { className: 'row' }, existing), h('div', { className: 'row' }, name, type), add];
  if (occ.relation) {
    const relId = occ.relation.id;
    const remove = () =>
      app.commit(() => {
        removeRelation(doc, bom, relId);
        app.state.selected = parentAddress(occ.address);
      });
    out.push(button({ className: 'danger' }, remove, 'Remove from parent'));
  }
  return out;
}
