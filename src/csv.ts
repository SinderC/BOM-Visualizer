import { exprNames, validate } from './expr';
import {
  addBom,
  addFamily,
  addItem,
  addItemType,
  addRelation,
  setFamilyValues,
  type ItemType,
  isIsoDate,
  isUnit,
  parseQty,
  type Bom,
  type BomDocument,
  type Effectivity,
  type Relation,
} from './model';

/**
 * Splits CSV text into rows of fields (RFC 4180 quoting). The delimiter is `;` when the header has more semicolons
 * than commas, as Excel writes in many European locales, else `,`. Blank lines are kept as rows with one empty field.
 */
export function parseCsv(text: string): string[][] {
  text = text.replace(/^﻿/, '');
  const header = text.split(/\r?\n/, 1)[0];
  const sep = header.split(';').length > header.split(',').length ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') field += text[i++];
      else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      rows.push([...row, field]);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) throw new Error('A quoted field is not closed');
  if (row.length || field) rows.push([...row, field]);
  return rows;
}

/** Header names are matched ignoring case, spaces, dots, dashes and underscores: `Find No.` = `FindNo`. */
const normalize = (name: string) => name.toLowerCase().replace(/[\s._-]/g, '');

/** Item types, and variant values by family, that the CSV uses but the document lacks. A family not in it is new. */
export interface Missing {
  types: ItemType[];
  values: Map<string, string[]>;
}

export type CsvImport = ({ doc: BomDocument; bom: Bom; reused: Set<string> } | { errors: string[] }) & { missing: Missing };

type Line = { row: number; get: (name: string) => string };

/**
 * Builds a new BOM from CSV rows of Parent, ID and optional Name, Type, Description, Qty, FindNo, Variant,
 * EffDateFrom, EffDateTo, EffUnitFrom, EffUnitTo (see docs/schema.md). The row with a blank Parent is the root; every
 * other row is a relation. IDs already in the document reuse that item (`reused`). Works on a copy of `doc` and
 * returns it with the new BOM, or every problem by spreadsheet row number; `doc` is left unchanged. Either way lists
 * the item types and variant values it lacks; with `createMissing` they are added, else they are problems.
 */
export function importCsv(doc: BomDocument, text: string, bomName: string, createMissing = false): CsvImport {
  const fatal = (message: string): CsvImport => ({ errors: [message], missing: { types: [], values: new Map() } });
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (e) {
    return fatal((e as Error).message);
  }
  const [header = [], ...rows] = table;
  const columns = new Map(header.map((h, i) => [normalize(h), i]));
  if (!columns.has('parent') || !columns.has('id')) return fatal('The CSV header needs Parent and ID columns');
  const lines: Line[] = rows.flatMap((cells, i) =>
    cells.some((c) => c.trim()) ? [{ row: i + 2, get: (name: string) => cells[columns.get(normalize(name)) ?? -1]?.trim() ?? '' }] : [],
  );

  const draft = structuredClone(doc);
  const missing = findMissing(doc, lines);
  if (createMissing) {
    for (const t of missing.types) addItemType(draft, t.name, t.prefix);
    for (const [name, values] of missing.values) {
      const family = draft.families.find((f) => f.name === name);
      if (family) setFamilyValues(draft, name, [...family.values, ...values]);
      else addFamily(draft, name, values);
    }
  }
  const problems: { row: number; message: string }[] = [];
  const fail = (row: number, message: string) => problems.push({ row, message });
  const ids = new Set(lines.map((l) => l.get('ID')));
  const roots = lines.filter((l) => !l.get('Parent'));
  if (roots.length !== 1) fail(0, `Exactly one row needs a blank Parent (the root); found ${roots.length}`);
  for (const l of lines) {
    const parent = l.get('Parent');
    if (!l.get('ID')) fail(l.row, 'ID is empty');
    else if (parent && !ids.has(parent)) fail(l.row, `parent ${parent} is not the ID of any row`);
  }
  for (const l of lines) {
    const id = l.get('ID');
    if (!id || draft.items.has(id)) continue;
    const type = l.get('Type') || undefined;
    if (type && !draft.itemTypes.some((t) => t.name === type)) {
      fail(l.row, `unknown type '${type}' (known: ${draft.itemTypes.map((t) => t.name).join(', ')})`);
      continue;
    }
    try {
      addItem(draft, l.get('Name'), l.get('Description'), type, id);
    } catch (e) {
      fail(l.row, (e as Error).message);
    }
  }

  // Fields are checked on every row; relations, and so cycles, only once the rows above form a tree.
  const bom = problems.length ? undefined : addBom(draft, bomName, undefined, roots[0].get('ID'));
  for (const l of lines) {
    if (!l.get('Parent')) continue;
    const before = problems.length;
    const patch = relationFields(l.get, draft, (message) => fail(l.row, message));
    if (!bom || problems.length > before) continue;
    try {
      Object.assign(addRelation(draft, bom, l.get('Parent'), l.get('ID')), patch);
    } catch (e) {
      fail(l.row, (e as Error).message);
    }
  }
  if (!bom || problems.length) {
    // Stable sort: a row's problems keep their order; the one without a row goes first.
    return { errors: problems.sort((a, b) => a.row - b.row).map((p) => (p.row ? `Row ${p.row}: ${p.message}` : p.message)), missing };
  }
  return { doc: draft, bom, reused: new Set([...ids].filter((id) => doc.items.has(id))), missing };
}

/**
 * Types of new items and variant values of relations that the document lacks, in order of first use. A new type's ID
 * prefix is the start its items' IDs share, up to the first digit or space: G-100 and G-101 give `G-`.
 */
function findMissing(doc: BomDocument, lines: Line[]): Missing {
  const typeIds = new Map<string, string[]>();
  const seen = new Set<string>();
  const values = new Map<string, string[]>();
  for (const l of lines) {
    const id = l.get('ID');
    const type = l.get('Type');
    if (id && !seen.has(id) && !doc.items.has(id) && type && !doc.itemTypes.some((t) => t.name === type)) {
      typeIds.set(type, [...(typeIds.get(type) ?? []), id]);
    }
    seen.add(id);
    if (!l.get('Parent')) continue; // the root row has no relation
    for (const cmp of exprNames(l.get('Variant'))) {
      const known = doc.families.find((f) => f.name === cmp.family)?.values ?? [];
      const added = values.get(cmp.family) ?? [];
      added.push(...new Set(cmp.values.filter((v) => !known.includes(v) && !added.includes(v))));
      if (added.length) values.set(cmp.family, added);
    }
  }
  const types = [...typeIds].map(([name, ids]) => ({ name, prefix: commonStart(ids).match(/^[^\d\s]*/)![0] }));
  return { types, values };
}

function commonStart(strings: string[]): string {
  return strings.reduce((a, b) => {
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
}

/** Qty, find number, variant and effectivity of a row; blank fields are left out so the relation keeps its default. */
function relationFields(get: (name: string) => string, doc: BomDocument, fail: (message: string) => void): Partial<Relation> {
  const patch: Partial<Relation> = {};
  const qty = get('Qty');
  if (qty) {
    patch.qty = parseQty(qty, NaN);
    if (Number.isNaN(patch.qty)) fail(`Qty '${qty}' must be a number of 0 or more`);
  }
  if (get('FindNo')) patch.findNo = get('FindNo');
  const variant = get('Variant');
  if (variant) {
    patch.variantExpr = variant;
    for (const e of validate(variant, doc.families)) fail(`variant: ${e.message}`);
  }
  const eff: Effectivity = {};
  const column = (key: string) => `Eff${key[0].toUpperCase()}${key.slice(1)}`;
  for (const key of ['dateFrom', 'dateTo'] as const) {
    const v = get(column(key));
    if (v && !isIsoDate(v)) fail(`${column(key)} '${v}' must be a yyyy-mm-dd date`);
    if (v) eff[key] = v;
  }
  for (const key of ['unitFrom', 'unitTo'] as const) {
    const v = get(column(key));
    if (!v || v.toUpperCase() === 'UP') continue;
    if (!isUnit(Number(v))) fail(`${column(key)} '${v}' must be a whole number of 1 or more`);
    eff[key] = Number(v);
  }
  patch.eff = eff;
  return patch;
}
