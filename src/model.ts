import { renameFamilyInExpr, renameValueInExpr } from './expr';

export interface Effectivity {
  dateFrom?: string; // ISO yyyy-mm-dd, inclusive
  dateTo?: string;
  unitFrom?: number; // inclusive
  unitTo?: number; // undefined = UP
}

export interface Item {
  id: string;
  name: string;
  description: string;
  type?: string; // name of one of BomDocument.itemTypes
}

export interface ItemType {
  name: string;
  prefix: string; // start of the ids of items of this type; '' gives bare numbers
}

/** Parent→child usage within one BOM. Variant and effectivity live here, not on the item. */
export interface Relation {
  id: string;
  parentId: string;
  childId: string;
  qty: number;
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

export interface BomDocument {
  itemTypes: ItemType[];
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
  const doc: BomDocument = { itemTypes: DEFAULT_ITEM_TYPES.map((t) => ({ ...t })), items: new Map(), families: [], boms: [], alignments: [] };
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

function childrenOf(bom: Bom, itemId: string): Relation[] {
  return bom.relations.filter((r) => r.parentId === itemId);
}

/** Natural order, so `9` < `10` < `10A`; ties keep file order. */
const byFindNo = (a: Relation, b: Relation) => a.findNo.localeCompare(b.findNo, undefined, { numeric: true });

/** Children in display order (by find number). */
export function sortedChildren(bom: Bom, itemId: string): Relation[] {
  return childrenOf(bom, itemId).sort(byFindNo);
}

const newRelationId = (doc: BomDocument) => nextId('R', allRelations(doc).map((r) => r.id));

/** Id prefix of items of the type; `I` for untyped items. */
function idPrefix(doc: BomDocument, type?: string): string {
  return type === undefined ? 'I' : (findItemType(doc, type)?.prefix ?? '');
}

/** The start of the item's id that its type fixes, or '' when it is untyped or its id does not start with the prefix. */
export function lockedIdPrefix(doc: BomDocument, item: Item): string {
  const prefix = item.type === undefined ? '' : idPrefix(doc, item.type);
  return item.id.startsWith(prefix) ? prefix : '';
}

export function addItem(doc: BomDocument, name: string, description = '', type?: string): Item {
  const item = { id: nextId(idPrefix(doc, type), doc.items.keys()), name, description, type };
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
  if (!newId || /\s/.test(newId)) throw new Error('Item ID must be non-empty and contain no spaces');
  if (newId === oldId) return;
  if (doc.items.has(newId)) throw new Error(`Item ID ${newId} is already in use`);
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

function getFamily(doc: BomDocument, name: string): OptionFamily {
  const family = doc.families.find((f) => f.name === name);
  if (!family) throw new Error(`Unknown variant family ${name}`);
  return family;
}

/** Adds an empty family named `FAMILY<n>` with the first free n. */
export function addFamily(doc: BomDocument): OptionFamily {
  let n = doc.families.length + 1;
  while (doc.families.some((f) => f.name === `FAMILY${n}`)) n++;
  const family = { name: `FAMILY${n}`, values: [] };
  doc.families.push(family);
  return family;
}

/** Variant expressions quote names, so a family or value name cannot contain a double quote. */
const hasQuote = (names: string[]) => names.some((n) => n.includes('"'));

/** Applies `rewrite` to every relation's variant expression in all BOMs. */
function rewriteExprs(doc: BomDocument, rewrite: (expr: string) => string): void {
  for (const bom of doc.boms) for (const r of bom.relations) r.variantExpr = rewrite(r.variantExpr);
}

/** Renames a family and updates the variant expressions that use it. */
export function renameFamily(doc: BomDocument, oldName: string, newName: string): void {
  const family = getFamily(doc, oldName);
  if (!newName || doc.families.some((f) => f !== family && f.name === newName)) {
    throw new Error(`Family name '${newName}' is empty or already used`);
  }
  if (hasQuote([newName])) throw new Error(`Family name '${newName}' cannot contain '"'`);
  rewriteExprs(doc, (e) => renameFamilyInExpr(e, oldName, newName));
  family.name = newName;
}

/**
 * Sets a family's values, trimmed, without blanks or duplicates. With the same number of values, a value replaced at
 * its position by a new one is a rename: expressions that use it are updated. Returns the renames, old → new.
 */
export function setFamilyValues(doc: BomDocument, name: string, values: string[]): Map<string, string> {
  const family = getFamily(doc, name);
  const next = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (hasQuote(next)) throw new Error(`Values of ${name} cannot contain '"'`);
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

export function removeFamily(doc: BomDocument, name: string): void {
  doc.families = doc.families.filter((f) => f.name !== name);
}

/** True if `ancestorId` is reachable from `itemId` going downwards in the BOM. */
function reaches(bom: Bom, itemId: string, ancestorId: string): boolean {
  if (itemId === ancestorId) return true;
  return childrenOf(bom, itemId).some((r) => reaches(bom, r.childId, ancestorId));
}

function assertNoCycle(bom: Bom, parentId: string, childId: string): void {
  if (reaches(bom, childId, parentId)) throw new Error(`Adding ${childId} under ${parentId} would create a cycle`);
}

/** Find number after the highest one under `parentId`, in steps of 10. */
function nextFindNo(bom: Bom, parentId: string): string {
  return String(Math.max(0, ...childrenOf(bom, parentId).map((r) => Number(r.findNo) || 0)) + 10);
}

/**
 * Find number that puts `rel` right before sibling `beforeId` under `parentId`, or last when `beforeId` is undefined.
 * Uses the midpoint of the neighbours' numbers; renumbers all siblings in steps of 10 when there is no whole-number gap.
 */
function placeFindNo(bom: Bom, rel: Relation, parentId: string, beforeId?: string): string {
  if (beforeId === undefined) return nextFindNo(bom, parentId);
  const siblings = sortedChildren(bom, parentId).filter((r) => r !== rel);
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
  assertNoCycle(bom, parentId, childId);
  const rel: Relation = {
    id: newRelationId(doc),
    parentId,
    childId,
    qty: 1,
    findNo: nextFindNo(bom, parentId),
    variantExpr: '',
    eff: {},
  };
  bom.relations.push(rel);
  return rel;
}

/** Parses an edited qty; blank, non-numeric or negative input keeps `current`. Zero is valid. */
export function parseQty(v: string, current: number): number {
  const n = Number(v);
  return v !== '' && Number.isFinite(n) && n >= 0 ? n : current;
}

/** Unit (serial) numbers start at 1. */
export const isUnit = (n: number) => Number.isInteger(n) && n >= 1;

/** Parses an edited effectivity unit; blank clears it (UP for unitTo), anything but a unit number keeps `current`. */
export function parseUnit(v: string, current: number | undefined): number | undefined {
  if (v === '') return undefined;
  const n = Number(v);
  return isUnit(n) ? n : current;
}

export function updateRelation(bom: Bom, id: string, patch: Partial<Omit<Relation, 'id'>>): void {
  const rel = bom.relations.find((r) => r.id === id);
  if (rel) Object.assign(rel, patch);
}

function getRelation(bom: Bom, id: string): Relation {
  const rel = bom.relations.find((r) => r.id === id);
  if (!rel) throw new Error(`Unknown relation ${id}`);
  return rel;
}

/**
 * Moves a relation under `parentId`, before sibling `beforeId` (or last). Keeps its id, qty, variant and effectivity;
 * only the find number changes (see placeFindNo). Alignments of the moved subtree are removed, as its addresses change.
 */
export function moveRelation(doc: BomDocument, bom: Bom, id: string, parentId: string, beforeId?: string): Relation {
  const rel = getRelation(bom, id);
  if (beforeId === id) return rel;
  assertNoCycle(bom, parentId, rel.childId);
  rel.findNo = placeFindNo(bom, rel, parentId, beforeId);
  rel.parentId = parentId;
  pruneAlignments(doc);
  return rel;
}

/** Adds a copy of a relation (same child, qty, variant, effectivity) under `parentId`, before sibling `beforeId` (or last). */
export function copyRelation(doc: BomDocument, bom: Bom, id: string, parentId: string, beforeId?: string): Relation {
  const src = getRelation(bom, id);
  assertNoCycle(bom, parentId, src.childId);
  const rel: Relation = { ...src, eff: { ...src.eff }, id: newRelationId(doc), parentId };
  rel.findNo = placeFindNo(bom, rel, parentId, beforeId);
  bom.relations.push(rel);
  return rel;
}

/**
 * Moves (or copies) relations under `parentId`, before sibling `beforeId` (or last), keeping their given order.
 * When moving, a `beforeId` that is itself moved is replaced by the next sibling that stays.
 */
export function moveRelations(doc: BomDocument, bom: Bom, ids: string[], parentId: string, beforeId: string | undefined, copy: boolean): Relation[] {
  if (copy) return ids.map((id) => copyRelation(doc, bom, id, parentId, beforeId));
  if (beforeId !== undefined && ids.includes(beforeId)) {
    const siblings = sortedChildren(bom, parentId);
    beforeId = siblings.slice(siblings.findIndex((r) => r.id === beforeId)).find((r) => !ids.includes(r.id))?.id;
  }
  return ids.map((id) => moveRelation(doc, bom, id, parentId, beforeId));
}

/**
 * Removes the relation, and the child's own relations if the child is no longer used in this BOM. Alignments of the
 * removed occurrences are removed too.
 */
export function removeRelation(doc: BomDocument, bom: Bom, id: string): void {
  const remove = (id: string) => {
    const rel = bom.relations.find((r) => r.id === id);
    if (!rel) return;
    bom.relations = bom.relations.filter((r) => r !== rel);
    const stillUsed = rel.childId === bom.rootId || bom.relations.some((r) => r.childId === rel.childId);
    if (!stillUsed) {
      for (const child of childrenOf(bom, rel.childId)) remove(child.id);
    }
  };
  remove(id);
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
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (itemId: string): string | undefined => {
    if (onPath.has(itemId)) return itemId;
    if (done.has(itemId)) return undefined;
    onPath.add(itemId);
    for (const r of childrenOf(bom, itemId)) {
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
