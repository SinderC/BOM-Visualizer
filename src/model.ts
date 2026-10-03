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
  if (!newId || /\s/.test(newId)) throw new Error('Item id must be non-empty and contain no spaces');
  if (newId === oldId) return;
  if (doc.items.has(newId)) throw new Error(`Item id ${newId} is already in use`);
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

export function addRelation(doc: BomDocument, bom: Bom, parentId: string, childId: string): Relation {
  if (!doc.items.has(parentId) || !doc.items.has(childId)) throw new Error('Unknown item');
  if (reaches(bom, childId, parentId)) {
    throw new Error(`Adding ${childId} under ${parentId} would create a cycle`);
  }
  const siblings = childrenOf(bom, parentId);
  const maxFind = Math.max(0, ...siblings.map((r) => Number(r.findNo) || 0));
  const rel: Relation = {
    id: nextId('R', allRelations(doc).map((r) => r.id)),
    parentId,
    childId,
    qty: 1,
    findNo: String(maxFind + 10),
    variantExpr: '',
    eff: {},
  };
  bom.relations.push(rel);
  return rel;
}

export function updateRelation(bom: Bom, id: string, patch: Partial<Omit<Relation, 'id'>>): void {
  const rel = bom.relations.find((r) => r.id === id);
  if (rel) Object.assign(rel, patch);
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
