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
  type?: string; // one of BomDocument.itemTypes
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

/** Link between two occurrences (see occurrencePath). Stored only; no UI yet. */
export interface Alignment {
  id: string;
  source: string;
  target: string;
}

/** Starting list for new documents and for files written before item types existed. */
export const DEFAULT_ITEM_TYPES = ['Part', 'Assembly', 'Station'];

export interface BomDocument {
  itemTypes: string[];
  items: Map<string, Item>;
  families: OptionFamily[];
  boms: Bom[];
  alignments: Alignment[];
}

/** Stable occurrence address, e.g. `EBOM:R1/R5`. The root occurrence is `EBOM:`. */
export function occurrencePath(bomId: string, relationIds: string[]): string {
  return `${bomId}:${relationIds.join('/')}`;
}

export function createDocument(): BomDocument {
  const doc: BomDocument = { itemTypes: [...DEFAULT_ITEM_TYPES], items: new Map(), families: [], boms: [], alignments: [] };
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

export function findBom(doc: BomDocument, bomId: string): Bom | undefined {
  return doc.boms.find((b) => b.id === bomId);
}

export function childrenOf(bom: Bom, itemId: string): Relation[] {
  return bom.relations.filter((r) => r.parentId === itemId);
}

/** Natural order, so `9` < `10` < `10A`; ties keep file order. */
export const byFindNo = (a: Relation, b: Relation) => a.findNo.localeCompare(b.findNo, undefined, { numeric: true });

/** Children in display order (by find number). */
export function sortedChildren(bom: Bom, itemId: string): Relation[] {
  return childrenOf(bom, itemId).sort(byFindNo);
}

const newRelationId = (doc: BomDocument) => nextId('R', allRelations(doc).map((r) => r.id));

/** Id prefix from the type's first letter, e.g. `P-` for Part; `I` for untyped items. */
export function itemIdPrefix(type?: string): string {
  return type ? `${type[0].toUpperCase()}-` : 'I';
}

export function addItem(doc: BomDocument, name: string, description = '', type?: string): Item {
  const item = { id: nextId(itemIdPrefix(type), doc.items.keys()), name, description, type };
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

/** Adds a type to the document's item type list; returns the trimmed name. */
export function addItemType(doc: BomDocument, name: string): string {
  const type = name.trim();
  if (!type) throw new Error('Type name is empty');
  if (!doc.itemTypes.includes(type)) doc.itemTypes.push(type);
  return type;
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
 * only the find number changes (see placeFindNo).
 */
export function moveRelation(bom: Bom, id: string, parentId: string, beforeId?: string): Relation {
  const rel = getRelation(bom, id);
  if (beforeId === id) return rel;
  assertNoCycle(bom, parentId, rel.childId);
  rel.findNo = placeFindNo(bom, rel, parentId, beforeId);
  rel.parentId = parentId;
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

/** Removes the relation, and the child's own relations if the child is no longer used in this BOM. */
export function removeRelation(bom: Bom, id: string): void {
  const rel = bom.relations.find((r) => r.id === id);
  if (!rel) return;
  bom.relations = bom.relations.filter((r) => r !== rel);
  const stillUsed = rel.childId === bom.rootId || bom.relations.some((r) => r.childId === rel.childId);
  if (!stillUsed) {
    for (const child of childrenOf(bom, rel.childId)) removeRelation(bom, child.id);
  }
}

export function addBom(doc: BomDocument, name: string, type?: BomType, rootId?: string): Bom {
  const root = rootId ?? addItem(doc, `${name} root`).id;
  const bom: Bom = { id: nextId('B', doc.boms.map((b) => b.id)), name, type, rootId: root, relations: [] };
  doc.boms.push(bom);
  return bom;
}

/** Structural checks used when loading a document. Returns human-readable errors. */
export function validateDocument(doc: BomDocument): string[] {
  const errors: string[] = [];
  const relIds = new Set<string>();
  const bomIds = new Set<string>();
  for (const item of doc.items.values()) {
    if (item.type && !doc.itemTypes.includes(item.type)) errors.push(`Item ${item.id}: unknown type '${item.type}'`);
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
