import { BOM_TYPES, DEFAULT_ITEM_TYPES, validateDocument, type Bom, type BomType, type BomDocument, type Effectivity, type Relation } from './model';

const FORMAT_VERSION = 1;

/** Parses a `<bomDocument>`. Unknown elements and attributes are ignored. Throws on invalid input. */
export function parseXml(text: string): BomDocument {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('File is not well-formed XML');
  const root = xml.documentElement;
  if (root.tagName !== 'bomDocument') throw new Error(`Expected <bomDocument> root, found <${root.tagName}>`);
  const version = Number(root.getAttribute('version') ?? FORMAT_VERSION);
  if (!Number.isInteger(version) || version > FORMAT_VERSION) {
    throw new Error(`Unsupported format version ${root.getAttribute('version')} (this app reads up to ${FORMAT_VERSION})`);
  }

  const typeList = kids(root, 'itemTypes')[0];
  const itemTypes = typeList ? kids(typeList, 'type').map((t) => t.textContent?.trim() ?? '') : [...DEFAULT_ITEM_TYPES];
  const doc: BomDocument = { itemTypes, items: new Map(), families: [], boms: [], alignments: [] };

  for (const f of path(root, 'optionFamilies', 'family')) {
    doc.families.push({ name: req(f, 'name'), values: kids(f, 'value').map((v) => v.textContent?.trim() ?? '') });
  }
  for (const i of path(root, 'items', 'item')) {
    const id = req(i, 'id');
    if (doc.items.has(id)) throw new Error(`Duplicate item id ${id}`);
    doc.items.set(id, {
      id,
      name: i.getAttribute('name') ?? '',
      description: i.getAttribute('description') ?? '',
      type: i.getAttribute('type') || undefined,
    });
  }
  for (const b of kids(root, 'bom')) {
    const id = req(b, 'id');
    const type = b.getAttribute('type') || undefined;
    if (type && !BOM_TYPES.includes(type as BomType)) throw new Error(`BOM ${id}: unknown type '${type}'`);
    const bom: Bom = { id, name: b.getAttribute('name') ?? '', type: type as BomType | undefined, rootId: req(b, 'root'), relations: [] };
    for (const r of path(b, 'relations', 'relation')) bom.relations.push(parseRelation(r));
    doc.boms.push(bom);
  }
  for (const a of path(root, 'alignments', 'alignment')) {
    doc.alignments.push({ id: req(a, 'id'), source: req(a, 'source'), target: req(a, 'target') });
  }

  if (!doc.boms.length) throw new Error('Document contains no <bom>');
  const errors = validateDocument(doc);
  if (errors.length) throw new Error(errors.join('\n'));
  return doc;
}

function parseRelation(r: Element): Relation {
  const id = req(r, 'id');
  const qty = Number(r.getAttribute('qty') ?? 1);
  if (!Number.isFinite(qty) || qty < 0) throw new Error(`Relation ${id}: invalid qty`);
  const e = kids(r, 'effectivity')[0];
  const eff: Effectivity = {};
  if (e) {
    eff.dateFrom = e.getAttribute('dateFrom') || undefined;
    eff.dateTo = e.getAttribute('dateTo') || undefined;
    eff.unitFrom = unit(e, 'unitFrom', id);
    eff.unitTo = unit(e, 'unitTo', id);
  }
  return {
    id,
    parentId: req(r, 'parent'),
    childId: req(r, 'child'),
    qty,
    findNo: r.getAttribute('findNo') ?? '',
    variantExpr: kids(r, 'variant')[0]?.textContent?.trim() ?? '',
    eff,
  };
}

function unit(el: Element, attr: string, relId: string): number | undefined {
  const raw = el.getAttribute(attr);
  if (!raw || raw.toUpperCase() === 'UP') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new Error(`Relation ${relId}: ${attr} must be an integer`);
  return n;
}

function kids(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

function path(el: Element, container: string, tag: string): Element[] {
  return kids(el, container).flatMap((c) => kids(c, tag));
}

function req(el: Element, attr: string): string {
  const v = el.getAttribute(attr);
  if (!v) throw new Error(`<${el.tagName}> is missing required attribute '${attr}'`);
  return v;
}

export function serializeXml(doc: BomDocument): string {
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', `<bomDocument version="${FORMAT_VERSION}">`];
  out.push('  <optionFamilies>');
  for (const f of doc.families) {
    out.push(`    <family${attrs({ name: f.name })}>${f.values.map((v) => `<value>${esc(v)}</value>`).join('')}</family>`);
  }
  out.push('  </optionFamilies>', '  <itemTypes>');
  for (const t of doc.itemTypes) out.push(`    <type>${esc(t)}</type>`);
  out.push('  </itemTypes>', '  <items>');
  for (const i of doc.items.values()) {
    out.push(`    <item${attrs({ id: i.id, type: i.type, name: i.name, description: i.description })}/>`);
  }
  out.push('  </items>');
  for (const b of doc.boms) {
    out.push(`  <bom${attrs({ id: b.id, name: b.name, type: b.type, root: b.rootId })}>`, '    <relations>');
    for (const r of b.relations) out.push(...serializeRelation(r));
    out.push('    </relations>', '  </bom>');
  }
  out.push('  <alignments>');
  for (const a of doc.alignments) out.push(`    <alignment${attrs({ id: a.id, source: a.source, target: a.target })}/>`);
  out.push('  </alignments>', '</bomDocument>', '');
  return out.join('\n');
}

function serializeRelation(r: Relation): string[] {
  const head = `      <relation${attrs({ id: r.id, parent: r.parentId, child: r.childId, qty: r.qty, findNo: r.findNo })}`;
  const body: string[] = [];
  if (r.variantExpr) body.push(`        <variant>${esc(r.variantExpr)}</variant>`);
  const effAttrs = attrs({ ...r.eff });
  if (effAttrs) body.push(`        <effectivity${effAttrs}/>`);
  return body.length ? [`${head}>`, ...body, '      </relation>'] : [`${head}/>`];
}

/** Renders non-empty attributes as ` key="value"`. */
function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
