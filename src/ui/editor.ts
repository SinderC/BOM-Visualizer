import { activeBom, openDoc, type App } from '../app';
import { setExpanded } from '../expanded';
import { validate } from '../expr';
import {
  addItem,
  addItemType,
  addRelation,
  addUom,
  DEFAULT_ITEM_TYPES,
  DEFAULT_UOM,
  lockedIdPrefix,
  nextItemId,
  occurrencePath,
  parentAddress,
  parseQty,
  parseUnit,
  removeRelations,
  renameItem,
  setItemType,
  setItemUom,
  typeIdPrefix,
  updateItem,
  updateRelation,
  usageCount,
  type Relation,
} from '../model';
import type { Occurrence, Status } from '../resolve';
import { showConfirmDialog, showNewItemTypeDialog, showNewUomDialog } from './dialogs';
import { button, dateField, field, h, input, isMac } from './dom';
import { attachExprCompletion } from './expr-complete';
import { isSectionOpen, setSectionOpen } from './view';

const STATUS_TEXT: Record<Status, string> = {
  included: 'Included',
  excludedByVariant: 'Excluded by variant',
  excludedByEff: 'Excluded by effectivity',
  excludedByParent: 'Excluded (parent excluded)',
};

/** Codes and numbers in Geist Mono, matching the tree-table. */
const MONO = { className: 'mono' };
const UNIT = { type: 'number', min: '1', step: '1' };
const NEW = '\0new'; // select value of the "New …" entry; cannot clash with a real name
const MIXED = '\0mixed'; // select value shown while selected items have different values

/**
 * Picker of a document list: `unset` labels the empty choice (value undefined), then `names`, then a `newLabel` entry
 * that asks for a new name with `askNew`. With `mixed`, it shows "— mixed —" until something is picked.
 */
function listSelect(
  app: App,
  name: string,
  { unset, names, newLabel, askNew }: { unset: string; names: string[]; newLabel: string; askNew: (pick: (v: string | undefined) => void) => void },
  value: string | undefined,
  onPick: (value: string | undefined) => void,
  mixed: boolean,
): HTMLSelectElement {
  const select = h(
    'select',
    { name, className: 'type-select' },
    ...(mixed ? [h('option', { value: MIXED, disabled: true }, '— mixed —')] : []),
    h('option', { value: '' }, unset),
    ...names.map((n) => h('option', { value: n }, n)),
    h('option', { value: NEW }, newLabel),
  );
  const initial = mixed ? MIXED : (value ?? '');
  select.value = initial;
  select.addEventListener('change', () => {
    if (select.value !== NEW) return app.commit(() => onPick(select.value || undefined));
    select.value = initial; // stays correct if the dialog is cancelled
    askNew((v) => app.tryCommit(() => onPick(v)));
  });
  return select;
}

/** Item type picker with a "New type…" entry that adds a type to the document via a dialog. */
export function typeSelect(
  app: App,
  name: string,
  value: string | undefined,
  onPick: (type: string | undefined) => void,
  mixed = false,
): HTMLSelectElement {
  const doc = openDoc(app.state);
  const askNew = (pick: (v: string) => void) => showNewItemTypeDialog((type, prefix) => pick(addItemType(doc, type, prefix)));
  return listSelect(app, name, { unset: '—', names: doc.itemTypes.map((t) => t.name), newLabel: 'New type…', askNew }, value, onPick, mixed);
}

/** Unit of measure picker: DEFAULT_UOM (undefined) first, and a "New unit…" entry that adds a unit to the document. */
export function uomSelect(
  app: App,
  name: string,
  value: string | undefined,
  onPick: (uom: string | undefined) => void,
  mixed = false,
): HTMLSelectElement {
  const doc = openDoc(app.state);
  const askNew = (pick: (v: string | undefined) => void) => showNewUomDialog((uom) => pick(addUom(doc, uom)));
  return listSelect(app, name, { unset: DEFAULT_UOM, names: doc.uoms, newLabel: 'New unit…', askNew }, value, onPick, mixed);
}

/**
 * Collapsible section whose open state is remembered by `key`; keep keys stable, as they are stored in view
 * preferences. The single and multiple selection views share keys.
 */
function section(key: string, heading: (Node | string)[], ...children: HTMLElement[]): HTMLDetailsElement {
  const details = h(
    'details',
    { open: isSectionOpen(key) },
    h('summary', {}, h('h3', {}, h('span', { className: 'caret' }), ...heading)),
    ...children,
  );
  details.addEventListener('toggle', () => setSectionOpen(key, details.open));
  return details;
}

/** Type for new children; remembered across renders so consecutive adds keep the last choice. */
let addChildType: string | undefined = DEFAULT_ITEM_TYPES[0].name;
/** Name and id typed for a new child; kept across renders, such as the one after picking its type, until the child is added. */
let addChildName = '';
let addChildId = '';

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
  const uom = uomSelect(app, 'item-uom', item.uom, (u) => setItemUom(doc, item.id, u));
  uom.title = "Unit of measure; the quantities of the item's relations are in it";

  return [
    section(
      'item',
      ['Item'],
      h('div', { className: 'row' }, field('ID', idControl), field('Type', type), field('UoM', uom)),
      field('Name', input('item-name', item.name, (v) => app.commit(() => updateItem(doc, item.id, { name: v || item.name })))),
      field('Description', description),
      h('p', { className: 'muted' }, `Used by ${uses} relation${uses === 1 ? '' : 's'} across all BOMs; item edits apply everywhere.`),
    ),
  ];
}

function relationSection(app: App, rel: Relation): HTMLElement[] {
  const bom = activeBom(app.state);
  const set = (patch: Partial<Relation>) => app.commit(() => updateRelation(bom, rel.id, patch));
  const setEff = (patch: Partial<Relation['eff']>) => set({ eff: { ...rel.eff, ...patch } });

  const expr = h('textarea', { name: 'rel-variant', value: rel.variantExpr, rows: 3, className: 'mono', spellcheck: false });
  attachExprCompletion(expr, () => openDoc(app.state).families);
  const errors = h('ul', { className: 'errors' });
  const showErrors = () =>
    errors.replaceChildren(
      ...validate(expr.value, openDoc(app.state).families).map((e) => h('li', {}, `col ${e.pos + 1}: ${e.message}`)),
    );
  showErrors();
  expr.addEventListener('input', showErrors);
  expr.addEventListener('change', () => set({ variantExpr: expr.value.trim() }));

  return [
    section(
      'relation',
      [`Relation ${rel.id}`, h('span', { className: 'muted' }, ` (parent ${rel.parentId})`)],
      h(
        'div',
        { className: 'row' },
        field('Qty', input('rel-qty', rel.qty, (v) => set({ qty: parseQty(v, rel.qty) }), { ...MONO, placeholder: 'number or A/R', title: 'A number of 0 or more, or A/R (as required)' })),
        field('Find no.', input('rel-find', rel.findNo, (v) => set({ findNo: v }), MONO)),
      ),
    ),
    section(
      'variant',
      ['Variant'],
      field('Variant expression', expr),
      errors,
      h('p', { className: 'muted hint' }, 'e.g. ENGINE=V8 AND (MARKET=EU OR TRIM IN (BASE, SPORT)), "Engine type"="V6 Turbo". Blank = always.'),
    ),
    section(
      'eff',
      ['Effectivity'],
      h(
        'div',
        { className: 'row' },
        field('Date from', dateField('eff-df', rel.eff.dateFrom, (v) => setEff({ dateFrom: v || undefined }))),
        field('Date to', dateField('eff-dt', rel.eff.dateTo, (v) => setEff({ dateTo: v || undefined }))),
      ),
      h(
        'div',
        { className: 'row' },
        field('Unit from', input('eff-uf', rel.eff.unitFrom, (v) => setEff({ unitFrom: parseUnit(v, rel.eff.unitFrom) }), UNIT)),
        field('Unit to', input('eff-ut', rel.eff.unitTo, (v) => setEff({ unitTo: parseUnit(v, rel.eff.unitTo) }), UNIT)),
      ),
    ),
  ];
}

/** Edits for several selected rows: the type and unit of their items, and removing them from their parents. */
function multiSection(app: App, focused: Occurrence): HTMLElement[] {
  const doc = openDoc(app.state);
  const occs = [focused, ...app.state.extraSelected.map((a) => app.occurrence(a)!)];
  const itemIds = [...new Set(occs.map((o) => o.item.id))];
  const relIds = [...new Set(occs.flatMap((o) => (o.relation ? [o.relation.id] : [])))];
  const types = new Set(itemIds.map((id) => doc.items.get(id)!.type));
  const uoms = new Set(itemIds.map((id) => doc.items.get(id)!.uom));

  // Items, not ids: an id changes with the type prefix.
  const items = itemIds.map((id) => doc.items.get(id)!);
  const type = typeSelect(app, 'multi-type', [...types][0], (t) => items.forEach((i) => setItemType(doc, i.id, t)), types.size > 1);
  const uom = uomSelect(app, 'multi-uom', [...uoms][0], (u) => items.forEach((i) => setItemUom(doc, i.id, u)), uoms.size > 1);

  const out: HTMLElement[] = [
    h('h2', {}, `${occs.length} rows selected`),
    h('p', { className: 'muted' }, `${itemIds.length} item${itemIds.length === 1 ? '' : 's'}; item edits apply everywhere.`),
    section('item', ['Item'], h('div', { className: 'row' }, field('Type', type), field('UoM', uom))),
  ];
  if (relIds.length) {
    const remove = () =>
      app.commit(() => {
        const bom = activeBom(app.state);
        removeRelations(doc, bom, relIds);
        app.state.selected = focused.relation ? parentAddress(focused.address) : focused.address;
        app.state.extraSelected = [];
      });
    const rows = `${relIds.length} row${relIds.length === 1 ? '' : 's'}`;
    out.push(section('structure', ['Structure'], removeButton(`Remove ${rows} from their parents?`, remove)));
  }
  return out;
}

function structureSection(app: App, occ: Occurrence): HTMLElement[] {
  const doc = openDoc(app.state);
  const bom = activeBom(app.state);

  const existing = h('select', { name: 'add-existing' }, h('option', { value: '' }, '— new item —'));
  // Filled when first used: an option per item on every render makes selecting rows slow in large documents.
  const fillExisting = () => {
    if (existing.options.length > 1) return;
    existing.append(...[...doc.items.values()].map((i) => h('option', { value: i.id }, `${i.id} ${i.name}`)));
  };
  existing.addEventListener('pointerdown', fillExisting);
  existing.addEventListener('focus', fillExisting);
  const name = h('input', { name: 'add-name', placeholder: 'New item name', value: addChildName });
  name.addEventListener('input', () => (addChildName = name.value));
  if (addChildType && !doc.itemTypes.some((t) => t.name === addChildType)) addChildType = undefined;
  const type = typeSelect(app, 'add-type', addChildType, (t) => (addChildType = t));
  type.title = 'Type of the new item; also sets its ID prefix';
  // As in the item's ID field, the type's prefix is fixed; left empty, the next free id is used.
  const prefix = typeIdPrefix(doc, addChildType);
  const id = h('input', {
    name: 'add-id',
    className: 'mono',
    title: 'ID of the new item; leave empty for the next free one',
    placeholder: nextItemId(doc, addChildType).slice(prefix.length),
    value: addChildId,
  });
  id.addEventListener('input', () => (addChildId = id.value));
  const idControl = prefix ? h('div', { className: 'id-input' }, h('span', { className: 'mono muted' }, prefix), id) : id;
  /** With `stay`, the parent stays selected, for adding several children in a row. */
  const addNew = (stay: boolean) =>
    app.tryCommit(() => {
      const newId = id.value.trim() ? prefix + id.value.trim() : undefined;
      const childId = existing.value || addItem(doc, name.value.trim() || 'New item', '', addChildType, newId).id;
      const rel = addRelation(doc, bom, occ.item.id, childId);
      addChildName = addChildId = '';
      setExpanded(occ, true);
      if (!stay) app.state.selected = occurrencePath(bom.id, [...occ.path, rel.id]);
    });
  const add = button({ className: 'primary' }, () => addNew(false), 'Add child');
  // A new item needs a type; an existing one has its own.
  const update = () => {
    name.disabled = id.disabled = type.disabled = !!existing.value;
    add.disabled = !existing.value && !addChildType;
    add.title = add.disabled ? 'Select an item type' : `Enter adds and selects the child; ${isMac ? '⌘' : 'Ctrl+'}Enter adds it and stays on this item`;
  };
  update();
  existing.addEventListener('change', update);
  for (const el of [name, id, type] as HTMLElement[]) {
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || add.disabled) return;
      e.preventDefault();
      addNew(isMac ? e.metaKey : e.ctrlKey);
    });
  }

  const addChild = h('div', { className: 'add-child' }, h('div', { className: 'row' }, existing), h('div', { className: 'row' }, name, idControl, type), add);
  const structure = section('structure', ['Structure'], addChild);
  if (occ.relation) {
    const relId = occ.relation.id;
    const remove = () =>
      app.commit(() => {
        removeRelations(doc, bom, [relId]);
        app.state.selected = parentAddress(occ.address);
      });
    const parent = app.occurrence(parentAddress(occ.address))!.item.name;
    structure.append(removeButton(`Remove ${occ.item.name} from ${parent}?`, remove));
  }
  return [structure];
}

/** "Remove from parent" button that asks first; the rows' children go too where they are not used elsewhere in the BOM. */
function removeButton(question: string, remove: () => void): HTMLButtonElement {
  const confirm = () => showConfirmDialog('Remove from parent', `${question} Children are removed too unless used elsewhere in this BOM.`, 'Remove', remove);
  return button({ className: 'danger' }, confirm, 'Remove from parent');
}
