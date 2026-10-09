import { renameFamilyInExpr, renameValueInExpr } from './expr';

export interface Effectivity {
  dateFrom?: string; // ISO yyyy-mm-dd, inclusive
  dateTo?: string;
  unitFrom?: number; // inclusive
  unitTo?: number; // undefined = open (UP in Teamcenter terms)
}

export interface Item {
  id: string;
  name: string;
  description: string;
  type?: string; // name of one of BomDocument.itemTypes
  uom?: string; // unit of measure, one of BomDocument.uoms; undefined = DEFAULT_UOM
}

export interface ItemType {
  name: string;
  prefix: string; // start of the ids of items of this type; '' gives bare numbers
}

/** "As required": the quantity is not fixed (glue, paint, shims, …). */
export const AS_REQUIRED = 'A/R';
export type Qty = number | typeof AS_REQUIRED;

/** Parent→child usage within one BOM. Variant and effectivity live here, not on the item. */
export interface Relation {
  id: string;
  parentId: string;
  childId: string;
  qty: Qty;
  findNo: string;
  variantExpr: string;
  eff: Effectivity;
}

export interface OptionFamily {
  name: string;
  values: string[];
}

export const BOM_TYPES = ['EBOM', 'DBOM', 'MBOM', 'SBOM'] as const;
export type BomType = (typeof BOM_TYPES)[number];

export interface Bom {
  id: string;
  name: string;
  type?: BomType; // absent in files written before types existed
  rootId: string;
  relations: Relation[];
}

/** Link between two occurrences in different BOMs (see occurrencePath). Removed when either occurrence disappears. */
export interface Alignment {
  id: string;
  source: string;
  target: string;
}

/** Starting list for new documents and for files written before item types existed. */
export const DEFAULT_ITEM_TYPES: readonly ItemType[] = [
  { name: 'Part Revision', prefix: 'P-' },
  { name: 'Design Revision', prefix: 'D-' },
];

/** Unit of measure of items that have none set. Built in: never stored in BomDocument.uoms or on an item. */
export const DEFAULT_UOM = 'each';

/** Starting unit list for new documents and for files written before units existed; DEFAULT_UOM comes on top. */
export const DEFAULT_UOMS: readonly string[] = ['kg', 'g', 'm', 'mm', 'm²', 'l'];

export interface BomDocument {
  itemTypes: ItemType[];
  uoms: string[]; // units items can have besides DEFAULT_UOM
  items: Map<string, Item>;
  families: OptionFamily[];
  boms: Bom[];
  alignments: Alignment[];
}

/** Stable occurrence address, e.g. `EBOM:R1/R5`. The root occurrence is `EBOM:`. */
export function occurrencePath(bomId: string, relationIds: string[]): string {
  return `${bomId}:${relationIds.join('/')}`;
}

/** Address of the parent occurrence: `EBOM:R3/R5` → `EBOM:R3`, `EBOM:R3` → `EBOM:`. */
export function parentAddress(address: string): string {
  const colon = address.indexOf(':');
  return address.slice(0, Math.max(address.lastIndexOf('/'), colon + 1));
}

const bomIdOf = (address: string) => address.slice(0, address.indexOf(':'));

/** True if the address is an occurrence of the document: each relation in the path hangs under the previous child. */
export function isOccurrence(doc: BomDocument, address: string): boolean {
  const colon = address.indexOf(':');
  const bom = colon > 0 ? findBom(doc, address.slice(0, colon)) : undefined;
  if (!bom) return false;
  const rest = address.slice(colon + 1);
  let itemId = bom.rootId;
  for (const relId of rest ? rest.split('/') : []) {
    const rel = bom.relations.find((r) => r.id === relId && r.parentId === itemId);
    if (!rel) return false;
    itemId = rel.childId;
  }
  return true;
}

export function createDocument(): BomDocument {
  const doc: BomDocument = {
    itemTypes: DEFAULT_ITEM_TYPES.map((t) => ({ ...t })),
    uoms: [...DEFAULT_UOMS],
    items: new Map(),
    families: [],
    boms: [],
    alignments: [],
  };
  addBom(doc, 'Main', 'EBOM');
  return doc;
}

/** Next free id with the given prefix, e.g. `R12` when `R11` is the highest. */
export function nextId(prefix: string, existing: Iterable<string>): string {
  let max = 0;
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)$`);
  for (const id of existing) {
    const m = re.exec(id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${max + 1}`;
}

function allRelations(doc: BomDocument): Relation[] {
  return doc.boms.flatMap((b) => b.relations);
}

/** Number of relations using the item, across all BOMs. */
export function usageCount(doc: BomDocument, itemId: string): number {
  return allRelations(doc).filter((r) => r.childId === itemId).length;
}

export function findBom(doc: BomDocument, bomId: string): Bom | undefined {
  return doc.boms.find((b) => b.id === bomId);
}

/** Natural order, so `9` < `10` < `10A`; ties keep file order. */
const byFindNo = (a: Relation, b: Relation) => a.findNo.localeCompare(b.findNo, undefined, { numeric: true });

/** Children in display order (by find number). */
export function sortedChildren(bom: Bom, itemId: string): Relation[] {
  return bom.relations.filter((r) => r.parentId === itemId).sort(byFindNo);
}

/**
 * Every parent's children in display order, by parent item id. For walking a whole BOM: sortedChildren scans all
 * relations per call, which takes seconds for tens of thousands of relations.
 */
export function childrenIndex(bom: Bom): Map<string, Relation[]> {
  const index = unsortedChildrenIndex(bom);
  for (const children of index.values()) children.sort(byFindNo);
  return index;
}

/** Like childrenIndex, in file order: sorting all of a large BOM takes longer than what most edits do with it. */
function unsortedChildrenIndex(bom: Bom): Map<string, Relation[]> {
  const index = new Map<string, Relation[]>();
  for (const r of bom.relations) {
    if (!index.has(r.parentId)) index.set(r.parentId, []);
    index.get(r.parentId)!.push(r);
  }
  return index;
}

const newRelationId = (doc: BomDocument) => nextId('R', allRelations(doc).map((r) => r.id));

/** Id prefix of items of the type; `I` for untyped items. */
function idPrefix(doc: BomDocument, type?: string): string {
  return type === undefined ? 'I' : (findItemType(doc, type)?.prefix ?? '');
}

/** The start of the item's id that its type fixes, or '' when it is untyped or its id does not start with the prefix. */
export function lockedIdPrefix(doc: BomDocument, item: Item): string {
  const prefix = typeIdPrefix(doc, item.type);
  return item.id.startsWith(prefix) ? prefix : '';
}

/** Id a new item of the type gets when none is given. */
export function nextItemId(doc: BomDocument, type?: string): string {
  return nextId(idPrefix(doc, type), doc.items.keys());
}

/** The prefix the type puts on ids of new items; '' for untyped items, whose ids are free-form. */
export function typeIdPrefix(doc: BomDocument, type?: string): string {
  return type === undefined ? '' : idPrefix(doc, type);
}

/** Throws unless the id can be given to an item: non-empty, no spaces and not in use. */
function checkFreeItemId(doc: BomDocument, id: string): void {
  if (!id || /\s/.test(id)) throw new Error('Item ID must be non-empty and contain no spaces');
  if (doc.items.has(id)) throw new Error(`Item ID ${id} is already in use`);
}

export function addItem(doc: BomDocument, name: string, description = '', type?: string, id = nextItemId(doc, type)): Item {
  checkFreeItemId(doc, id);
  const item = { id, name, description, type };
  doc.items.set(item.id, item);
  return item;
}

export function updateItem(doc: BomDocument, id: string, patch: Partial<Omit<Item, 'id'>>): void {
  const item = doc.items.get(id);
  if (item) Object.assign(item, patch);
}

/** Changes an item's id and rewrites every reference to it. Occurrence addresses use relation ids, so they are unaffected. */
export function renameItem(doc: BomDocument, oldId: string, newId: string): void {
  if (!doc.items.has(oldId)) throw new Error(`Unknown item ${oldId}`);
  if (newId === oldId) return;
  checkFreeItemId(doc, newId);
  // Rebuilt rather than delete+set to keep the item's position in the saved file.
  doc.items = new Map([...doc.items].map(([id, item]) => (id === oldId ? [newId, Object.assign(item, { id: newId })] : [id, item])));
  for (const bom of doc.boms) {
    if (bom.rootId === oldId) bom.rootId = newId;
    for (const r of bom.relations) {
      if (r.parentId === oldId) r.parentId = newId;
      if (r.childId === oldId) r.childId = newId;
    }
  }
}

/** The id with the new prefix in place of the old one (P-12 → D-12), or in front when the id does not start with the old one. */
const swapPrefix = (id: string, oldPrefix: string, newPrefix: string) =>
  newPrefix + (id.startsWith(oldPrefix) ? id.slice(oldPrefix.length) : id);

/**
 * Swaps the id prefix of the items; one whose new id is used takes the next free id instead. Items whose new id is free
 * go first, so that a renumbered item does not take it. Returns how many items were renumbered.
 */
function reprefixItems(doc: BomDocument, items: Item[], oldPrefix: string, newPrefix: string): number {
  const isTaken = (id: string) => !id || doc.items.has(id);
  const fits = items.filter((i) => !isTaken(swapPrefix(i.id, oldPrefix, newPrefix)));
  let renumbered = 0;
  for (const item of new Set([...fits, ...items])) {
    const id = swapPrefix(item.id, oldPrefix, newPrefix);
    if (id === item.id) continue;
    const taken = isTaken(id);
    renameItem(doc, item.id, taken ? nextId(newPrefix, doc.items.keys()) : id);
    if (taken) renumbered++;
  }
  return renumbered;
}

/** Changes the item's type and swaps its id prefix to match. */
export function setItemType(doc: BomDocument, id: string, type: string | undefined): void {
  const item = doc.items.get(id);
  if (!item) return;
  const oldPrefix = idPrefix(doc, item.type);
  item.type = type;
  reprefixItems(doc, [item], oldPrefix, idPrefix(doc, type));
}

function findItemType(doc: BomDocument, name: string): ItemType | undefined {
  return doc.itemTypes.find((t) => t.name === name);
}

function checkPrefix(prefix: string): string {
  const p = prefix.trim();
  if (/\s/.test(p)) throw new Error('ID prefix must contain no spaces');
  return p;
}

/** Adds a type to the document's item type list unless one has that name; returns the trimmed name. */
export function addItemType(doc: BomDocument, name: string, prefix = ''): string {
  const type = name.trim();
  if (!type) throw new Error('Type name is empty');
  if (!findItemType(doc, type)) doc.itemTypes.push({ name: type, prefix: checkPrefix(prefix) });
  return type;
}

/** Sets a type's id prefix and swaps it on the ids of all items of that type. */
export function setItemTypePrefix(doc: BomDocument, name: string, prefix: string): void {
  const type = findItemType(doc, name);
  if (!type) throw new Error(`Unknown item type ${name}`);
  const oldPrefix = type.prefix;
  type.prefix = checkPrefix(prefix);
  reprefixItems(doc, [...doc.items.values()].filter((i) => i.type === name), oldPrefix, type.prefix);
}

/** Number of items of the given type. */
export function itemTypeUsage(doc: BomDocument, type: string): number {
  return [...doc.items.values()].filter((i) => i.type === type).length;
}

/** Renames a type in place and on every item of that type. Item ids keep their old prefix. */
export function renameItemType(doc: BomDocument, oldName: string, newName: string): void {
  const type = newName.trim();
  if (!type || (type !== oldName && findItemType(doc, type))) throw new Error(`Type name '${type}' is empty or already used`);
  findItemType(doc, oldName)!.name = type;
  for (const item of doc.items.values()) if (item.type === oldName) item.type = type;
}

/**
 * Moves all items of one type to another, swapping their id prefixes, and removes the emptied type.
 * Returns how many items got a new number because their id was taken.
 */
export function migrateItemType(doc: BomDocument, from: string, to: string): number {
  if (from === to || !findItemType(doc, from) || !findItemType(doc, to)) throw new Error(`Cannot migrate ${from} to ${to}`);
  const items = [...doc.items.values()].filter((i) => i.type === from);
  for (const item of items) item.type = to;
  const renumbered = reprefixItems(doc, items, idPrefix(doc, from), idPrefix(doc, to));
  removeItemType(doc, from);
  return renumbered;
}

export function removeItemType(doc: BomDocument, name: string): void {
  const n = itemTypeUsage(doc, name);
  if (n) throw new Error(`Type ${name} is used by ${n} items`);
  doc.itemTypes = doc.itemTypes.filter((t) => t.name !== name);
}

/** A unit name as stored: trimmed, and undefined for blank or DEFAULT_UOM. */
export function normalizeUom(uom: string | undefined): string | undefined {
  const u = uom?.trim();
  return u && u !== DEFAULT_UOM ? u : undefined;
}

/** Sets an item's unit of measure; blank or DEFAULT_UOM clears it. */
export function setItemUom(doc: BomDocument, id: string, uom: string | undefined): void {
  const item = doc.items.get(id);
  if (!item) return;
  const u = normalizeUom(uom);
  if (u !== undefined && !doc.uoms.includes(u)) throw new Error(`Unknown unit ${u}`);
  item.uom = u;
}

/** Adds a unit to the document's list unless it is there or is DEFAULT_UOM; returns the stored name, undefined for DEFAULT_UOM. */
export function addUom(doc: BomDocument, name: string): string | undefined {
  if (!name.trim()) throw new Error('Unit name is empty');
  const u = normalizeUom(name);
  if (u !== undefined && !doc.uoms.includes(u)) doc.uoms.push(u);
  return u;
}

/** Number of items with the unit; undefined counts those with DEFAULT_UOM. */
export function uomUsage(doc: BomDocument, uom: string | undefined): number {
  return [...doc.items.values()].filter((i) => i.uom === uom).length;
}

/** Renames a unit in place and on every item that has it. */
export function renameUom(doc: BomDocument, oldName: string, newName: string): void {
  const u = normalizeUom(newName);
  if (u === undefined || (u !== oldName && doc.uoms.includes(u))) throw new Error(`Unit name '${newName.trim()}' is empty or already used`);
  const i = doc.uoms.indexOf(oldName);
  if (i < 0) throw new Error(`Unknown unit ${oldName}`);
  doc.uoms[i] = u;
  for (const item of doc.items.values()) if (item.uom === oldName) item.uom = u;
}

export function removeUom(doc: BomDocument, name: string): void {
  const n = uomUsage(doc, name);
  if (n) throw new Error(`Unit ${name} is used by ${n} items`);
  doc.uoms = doc.uoms.filter((u) => u !== name);
}

function getFamily(doc: BomDocument, name: string): OptionFamily {
  const family = doc.families.find((f) => f.name === name);
  if (!family) throw new Error(`Unknown variant family ${name}`);
  return family;
}

/** Variant expressions quote names, so a family or value name cannot contain a double quote. */
const hasQuote = (names: string[]) => names.some((n) => n.includes('"'));

/** Throws unless `name` can name `family` (or a new family): not empty, not used by another family, no quote. */
function checkFamilyName(doc: BomDocument, name: string, family?: OptionFamily): void {
  if (!name || doc.families.some((f) => f !== family && f.name === name)) {
    throw new Error(`Family name '${name}' is empty or already used`);
  }
  if (hasQuote([name])) throw new Error(`Family name '${name}' cannot contain '"'`);
}

/** Values trimmed, without blanks or duplicates. Throws on a quote. */
function familyValues(name: string, values: string[]): string[] {
  const out = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (hasQuote(out)) throw new Error(`Values of ${name} cannot contain '"'`);
  return out;
}

export function addFamily(doc: BomDocument, name: string, values: string[] = []): OptionFamily {
  checkFamilyName(doc, name);
  const family = { name, values: familyValues(name, values) };
  doc.families.push(family);
  return family;
}

/** Applies `rewrite` to every relation's variant expression in all BOMs. */
function rewriteExprs(doc: BomDocument, rewrite: (expr: string) => string): void {
  for (const bom of doc.boms) for (const r of bom.relations) r.variantExpr = rewrite(r.variantExpr);
}

/** Renames a family and updates the variant expressions that use it. */
export function renameFamily(doc: BomDocument, oldName: string, newName: string): void {
  const family = getFamily(doc, oldName);
  checkFamilyName(doc, newName, family);
  rewriteExprs(doc, (e) => renameFamilyInExpr(e, oldName, newName));
  family.name = newName;
}

/**
 * Sets a family's values, trimmed, without blanks or duplicates. With the same number of values, a value replaced at
 * its position by a new one is a rename: expressions that use it are updated. Returns the renames, old → new.
 */
export function setFamilyValues(doc: BomDocument, name: string, values: string[]): Map<string, string> {
  const family = getFamily(doc, name);
  const next = familyValues(name, values);
  const renames = new Map<string, string>();
  if (next.length === family.values.length) {
    // A value moved to another position is a reorder, not a rename.
    family.values.forEach((old, i) => {
      if (!next.includes(old) && !family.values.includes(next[i])) renames.set(old, next[i]);
    });
  }
  for (const [from, to] of renames) rewriteExprs(doc, (e) => renameValueInExpr(e, name, from, to));
  family.values = next;
  return renames;
}

/** Moves a family one place up (-1) or down (+1); the configuration panel lists families in this order. */
export function moveFamily(doc: BomDocument, name: string, step: -1 | 1): void {
  const from = doc.families.indexOf(getFamily(doc, name));
  const to = from + step;
  if (to < 0 || to >= doc.families.length) return;
  [doc.families[from], doc.families[to]] = [doc.families[to], doc.families[from]];
}

export function removeFamily(doc: BomDocument, name: string): void {
  doc.families = doc.families.filter((f) => f.name !== name);
}

/**
 * True if `to` is `from` or below it, given each item's child item ids. Visits each item once: shared subassemblies
 * would otherwise be walked once per use.
 */
export function reaches(childIds: (itemId: string) => string[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...childIds(id));
  }
  return false;
}

export const cycleError = (parentId: string, childId: string) => new Error(`Adding ${childId} under ${parentId} would create a cycle`);

/** `index` as from unsortedChildrenIndex. */
function assertNoCycle(index: Map<string, Relation[]>, parentId: string, childId: string): void {
  if (reaches((id) => (index.get(id) ?? []).map((r) => r.childId), childId, parentId)) throw cycleError(parentId, childId);
}

/** Find number after the highest one of `siblings`, in steps of 10. */
function nextFindNo(siblings: Relation[]): string {
  return String(Math.max(0, ...siblings.map((r) => Number(r.findNo) || 0)) + 10);
}

/**
 * Find number that puts `rel` right before sibling `beforeId` among `siblings` (the children of `parentId` in display
 * order), or last when `beforeId` is undefined. Uses the midpoint of the neighbours' numbers; renumbers all siblings in
 * steps of 10 when there is no whole-number gap.
 */
function placeFindNo(siblings: Relation[], rel: Relation, parentId: string, beforeId?: string): string {
  if (beforeId === undefined) return nextFindNo(siblings);
  siblings = siblings.filter((r) => r !== rel);
  const i = siblings.findIndex((r) => r.id === beforeId);
  if (i < 0) throw new Error(`Relation ${beforeId} is not under ${parentId}`);
  const prev = i ? Number(siblings[i - 1].findNo) : 0;
  const next = Number(siblings[i].findNo);
  if (Number.isInteger(prev) && Number.isInteger(next) && next - prev >= 2) return String(Math.floor((prev + next) / 2));
  siblings.splice(i, 0, rel);
  siblings.forEach((r, k) => (r.findNo = String((k + 1) * 10)));
  return rel.findNo;
}

export function addRelation(doc: BomDocument, bom: Bom, parentId: string, childId: string): Relation {
  if (!doc.items.has(parentId) || !doc.items.has(childId)) throw new Error('Unknown item');
  const index = unsortedChildrenIndex(bom);
  assertNoCycle(index, parentId, childId);
  const rel: Relation = {
    id: newRelationId(doc),
    parentId,
    childId,
    qty: 1,
    findNo: nextFindNo(index.get(parentId) ?? []),
    variantExpr: '',
    eff: {},
  };
  bom.relations.push(rel);
  return rel;
}

/** Parses an edited qty: a number of 0 or more, or A/R (any case); anything else keeps `current`. */
export function parseQty(v: string, current: Qty): Qty {
  if (v.trim().toUpperCase() === AS_REQUIRED) return AS_REQUIRED;
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n >= 0 ? n : current;
}

/** A yyyy-mm-dd date; rejects impossible dates such as 2026-02-30, which Date rolls over into March. */
export const isIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v);

/** Unit (serial) numbers start at 1. */
export const isUnit = (n: number) => Number.isInteger(n) && n >= 1;

/** Parses an edited effectivity unit; blank clears it (open-ended), anything but a unit number keeps `current`. */
export function parseUnit(v: string, current: number | undefined): number | undefined {
  if (v === '') return undefined;
  const n = Number(v);
  return isUnit(n) ? n : current;
}

export function updateRelation(bom: Bom, id: string, patch: Partial<Omit<Relation, 'id'>>): void {
  const rel = bom.relations.find((r) => r.id === id);
  if (rel) Object.assign(rel, patch);
}

/**
 * Moves relations, or adds copies of them (same child, qty, variant, effectivity), under `parentId`, before sibling
 * `beforeId` (or last), keeping their given order. A move keeps the relation's id; only the find number changes (see
 * placeFindNo). When moving, a `beforeId` that is itself moved is replaced by the next sibling that stays. Alignments
 * of moved subtrees are removed, as their addresses change.
 */
export function moveRelations(doc: BomDocument, bom: Bom, ids: string[], parentId: string, beforeId: string | undefined, copy: boolean): Relation[] {
  // Indexed once: scanning all relations per moved relation takes seconds for large selections and BOMs.
  const byId = new Map(bom.relations.map((r) => [r.id, r]));
  const index = unsortedChildrenIndex(bom); // kept up to date below, for the cycle checks of the next relations
  const siblings = (index.get(parentId) ?? []).sort(byFindNo); // and these in display order
  index.set(parentId, siblings);
  if (!copy && beforeId !== undefined && ids.includes(beforeId)) {
    const moved = new Set(ids);
    beforeId = siblings.slice(siblings.findIndex((r) => r.id === beforeId)).find((r) => !moved.has(r.id))?.id;
  }
  let relNo = Number(newRelationId(doc).slice(1));
  const placed = ids.map((id) => {
    const src = byId.get(id);
    if (!src) throw new Error(`Unknown relation ${id}`);
    assertNoCycle(index, parentId, src.childId);
    const rel = copy ? { ...src, eff: { ...src.eff }, id: `R${relNo++}`, parentId } : src;
    rel.findNo = placeFindNo(siblings, rel, parentId, beforeId);
    if (copy) bom.relations.push(rel);
    else {
      const from = index.get(rel.parentId)!;
      from.splice(from.indexOf(rel), 1);
      rel.parentId = parentId;
    }
    siblings.splice(beforeId === undefined ? siblings.length : siblings.findIndex((r) => r.id === beforeId), 0, rel);
    return rel;
  });
  if (!copy) pruneAlignments(doc);
  return placed;
}

/**
 * Removes the relations, and a child's own relations once the child is no longer used in this BOM. Alignments of the
 * removed occurrences are removed too.
 */
export function removeRelations(doc: BomDocument, bom: Bom, ids: string[]): void {
  const byId = new Map(bom.relations.map((r) => [r.id, r]));
  const index = unsortedChildrenIndex(bom);
  const uses = new Map<string, number>(); // relations per child item
  for (const r of bom.relations) uses.set(r.childId, (uses.get(r.childId) ?? 0) + 1);
  const removed = new Set<Relation>();
  const remove = (rel: Relation | undefined) => {
    if (!rel || removed.has(rel)) return;
    removed.add(rel);
    const left = uses.get(rel.childId)! - 1;
    uses.set(rel.childId, left);
    if (!left && rel.childId !== bom.rootId) for (const child of index.get(rel.childId) ?? []) remove(child);
  };
  for (const id of ids) remove(byId.get(id));
  bom.relations = bom.relations.filter((r) => !removed.has(r));
  pruneAlignments(doc);
}

/** Alignments with the occurrence at either end. */
function alignmentsOf(doc: BomDocument, address: string): Alignment[] {
  return doc.alignments.filter((a) => a.source === address || a.target === address);
}

export function addAlignment(doc: BomDocument, source: string, target: string): Alignment {
  if (!isOccurrence(doc, source) || !isOccurrence(doc, target)) throw new Error('Both ends must be occurrences');
  if (bomIdOf(source) === bomIdOf(target)) throw new Error('Both ends are in the same BOM');
  if (alignmentsOf(doc, source).some((a) => a.source === target || a.target === target)) throw new Error('Already aligned');
  const alignment = { id: nextId('A', doc.alignments.map((a) => a.id)), source, target };
  doc.alignments.push(alignment);
  return alignment;
}

export function removeAlignment(doc: BomDocument, id: string): void {
  doc.alignments = doc.alignments.filter((a) => a.id !== id);
}

/** Drops alignments with an end that is no longer an occurrence, after a relation is removed or moved. */
function pruneAlignments(doc: BomDocument): void {
  doc.alignments = doc.alignments.filter((a) => isOccurrence(doc, a.source) && isOccurrence(doc, a.target));
}

export function addBom(doc: BomDocument, name: string, type?: BomType, rootId?: string): Bom {
  const root = rootId ?? addItem(doc, `${name} root`).id;
  const bom: Bom = { id: nextId('B', doc.boms.map((b) => b.id)), name, type, rootId: root, relations: [] };
  doc.boms.push(bom);
  return bom;
}

/** Removes the BOM and its alignments. Items are kept, as they may be used elsewhere. */
export function removeBom(doc: BomDocument, bomId: string): void {
  if (doc.boms.length < 2) throw new Error('A document needs at least one BOM');
  doc.boms = doc.boms.filter((b) => b.id !== bomId);
  pruneAlignments(doc);
}

/** Structural checks used when loading a document. Returns human-readable errors. */
export function validateDocument(doc: BomDocument): string[] {
  const errors: string[] = [];
  const relIds = new Set<string>();
  const bomIds = new Set<string>();
  for (const f of doc.families) {
    if (hasQuote([f.name, ...f.values])) errors.push(`Variant family ${f.name}: names and values cannot contain '"'`);
  }
  for (const item of doc.items.values()) {
    if (item.type && !findItemType(doc, item.type)) errors.push(`Item ${item.id}: unknown type '${item.type}'`);
    if (item.uom && !doc.uoms.includes(item.uom)) errors.push(`Item ${item.id}: unknown unit '${item.uom}'`);
  }
  for (const bom of doc.boms) {
    if (bomIds.has(bom.id)) errors.push(`Duplicate BOM id ${bom.id}`);
    bomIds.add(bom.id);
    if (!doc.items.has(bom.rootId)) errors.push(`BOM ${bom.id}: root item ${bom.rootId} does not exist`);
    for (const r of bom.relations) {
      if (relIds.has(r.id)) errors.push(`Duplicate relation id ${r.id}`);
      relIds.add(r.id);
      if (!doc.items.has(r.parentId)) errors.push(`Relation ${r.id}: parent ${r.parentId} does not exist`);
      if (!doc.items.has(r.childId)) errors.push(`Relation ${r.id}: child ${r.childId} does not exist`);
    }
    const cycle = findCycle(bom);
    if (cycle) errors.push(`BOM ${bom.id}: cycle through ${cycle}`);
  }
  return errors;
}

function findCycle(bom: Bom): string | undefined {
  const children = childrenIndex(bom);
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (itemId: string): string | undefined => {
    if (onPath.has(itemId)) return itemId;
    if (done.has(itemId)) return undefined;
    onPath.add(itemId);
    for (const r of children.get(itemId) ?? []) {
      const hit = visit(r.childId);
      if (hit) return hit;
    }
    onPath.delete(itemId);
    done.add(itemId);
    return undefined;
  };
  for (const r of bom.relations) {
    const hit = visit(r.parentId);
    if (hit) return hit;
  }
  return undefined;
}
