import { describe, expect, it } from 'vitest';
import { addItem, addItemType, addRelation, copyRelation, createDocument, moveRelation, sortedChildren, nextId, parseQty, removeRelation, renameItem, validateDocument } from './model';

function setup() {
  const doc = createDocument();
  const bom = doc.boms[0];
  const a = addItem(doc, 'A');
  const b = addItem(doc, 'B');
  return { doc, bom, a, b, root: bom.rootId };
}

describe('model', () => {
  it('parseQty accepts zero and keeps the current qty for blank, non-numeric or negative input', () => {
    expect(parseQty('0', 3)).toBe(0);
    expect(parseQty('2.5', 3)).toBe(2.5);
    for (const v of ['', 'abc', '-1']) expect(parseQty(v, 3)).toBe(3);
  });

  it('generates next ids after the highest existing one', () => {
    expect(nextId('R', ['R1', 'R9', 'R10', 'X99'])).toBe('R11');
    expect(nextId('I', [])).toBe('I1');
    expect(nextId('P-', ['P-9', 'PX1', 'I3'])).toBe('P-10');
  });

  it('prefixes new item ids by type', () => {
    const doc = createDocument();
    expect(addItem(doc, 'Bolt', '', 'Part').id).toBe('P-1');
    expect(addItem(doc, 'Frame', '', 'Assembly').id).toBe('A-1');
    expect(addItem(doc, 'Nut', '', 'Part')).toMatchObject({ id: 'P-2', type: 'Part' });
    expect(addItem(doc, 'Thing').id).toBe('I2'); // I1 is the BOM root
  });

  it('assigns increasing find numbers', () => {
    const { doc, bom, a, b, root } = setup();
    expect(addRelation(doc, bom, root, a.id).findNo).toBe('10');
    expect(addRelation(doc, bom, root, b.id).findNo).toBe('20');
  });

  it('moves a relation to a new parent, keeping its data', () => {
    const { doc, bom, a, b, root } = setup();
    addRelation(doc, bom, root, a.id);
    const rel = addRelation(doc, bom, root, b.id);
    Object.assign(rel, { qty: 3, variantExpr: 'ENGINE=V8' });
    moveRelation(bom, rel.id, a.id);
    expect(rel).toMatchObject({ parentId: a.id, qty: 3, variantExpr: 'ENGINE=V8', findNo: '10' });
    expect(() => moveRelation(bom, rel.id, b.id)).toThrow(/cycle/);
    expect(rel.parentId).toBe(a.id);
  });

  it('places a moved relation between siblings by find number', () => {
    const { doc, bom, a, b, root } = setup();
    const c = addItem(doc, 'C');
    const [ra, rb, rc] = [a, b, c].map((i) => addRelation(doc, bom, root, i.id)); // 10, 20, 30
    moveRelation(bom, rc.id, root, rb.id);
    expect(rc.findNo).toBe('15');
    rb.findNo = '16';
    moveRelation(bom, ra.id, root, rb.id); // no gap between 15 and 16: renumber
    expect(sortedChildren(bom, root).map((r) => [r.id, r.findNo])).toEqual([
      [rc.id, '10'],
      [ra.id, '20'],
      [rb.id, '30'],
    ]);
  });

  it('copies a relation with its data under a new parent', () => {
    const { doc, bom, a, b, root } = setup();
    addRelation(doc, bom, root, a.id);
    const rb = addRelation(doc, bom, root, b.id);
    Object.assign(rb, { qty: 2, eff: { unitFrom: 5 } });
    const copy = copyRelation(doc, bom, rb.id, a.id);
    expect(copy).toMatchObject({ parentId: a.id, childId: b.id, qty: 2, eff: { unitFrom: 5 }, findNo: '10' });
    expect(copy.id).not.toBe(rb.id);
    expect(copy.eff).not.toBe(rb.eff);
    expect(rb.parentId).toBe(root);
    expect(() => copyRelation(doc, bom, copy.id, b.id)).toThrow(/cycle/);
  });

  it('rejects cycles', () => {
    const { doc, bom, a, b, root } = setup();
    addRelation(doc, bom, root, a.id);
    addRelation(doc, bom, a.id, b.id);
    expect(() => addRelation(doc, bom, b.id, a.id)).toThrow(/cycle/);
    expect(() => addRelation(doc, bom, a.id, a.id)).toThrow(/cycle/);
    expect(() => addRelation(doc, bom, b.id, root)).toThrow(/cycle/);
  });

  it('removes orphaned sub-structure but keeps it when the item is still used elsewhere', () => {
    const { doc, bom, a, b, root } = setup();
    const r1 = addRelation(doc, bom, root, a.id);
    const r2 = addRelation(doc, bom, root, a.id);
    addRelation(doc, bom, a.id, b.id);
    removeRelation(bom, r1.id);
    expect(bom.relations).toHaveLength(2);
    removeRelation(bom, r2.id);
    expect(bom.relations).toHaveLength(0);
  });

  it('flags duplicate relation ids, dangling refs and cycles', () => {
    const { doc, bom, a, b, root } = setup();
    const r = addRelation(doc, bom, root, a.id);
    bom.relations.push({ ...r }); // duplicate id
    bom.relations.push({ ...r, id: 'R50', parentId: a.id, childId: 'I999' });
    bom.relations.push({ ...r, id: 'R51', parentId: a.id, childId: b.id });
    bom.relations.push({ ...r, id: 'R52', parentId: b.id, childId: a.id });
    const errors = validateDocument(doc);
    expect(errors).toContain(`Duplicate relation id ${r.id}`);
    expect(errors).toContain('Relation R50: child I999 does not exist');
    expect(errors.some((e) => e.includes('cycle'))).toBe(true);
  });

  it('renames an item and rewrites relation and root references', () => {
    const { doc, bom, a, b, root } = setup();
    const r = addRelation(doc, bom, root, a.id);
    addRelation(doc, bom, a.id, b.id);
    renameItem(doc, a.id, 'PN-1');
    renameItem(doc, root, 'TOP');
    expect([...doc.items.keys()]).toEqual(['TOP', 'PN-1', b.id]);
    expect(doc.items.get('PN-1')!.id).toBe('PN-1');
    expect(bom.rootId).toBe('TOP');
    expect(bom.relations.find((x) => x.id === r.id)).toMatchObject({ parentId: 'TOP', childId: 'PN-1' });
    expect(validateDocument(doc)).toEqual([]);
  });

  it('rejects empty, spaced or taken item ids', () => {
    const { doc, a, b } = setup();
    expect(() => renameItem(doc, a.id, '')).toThrow(/non-empty/);
    expect(() => renameItem(doc, a.id, 'P 1')).toThrow(/no spaces/);
    expect(() => renameItem(doc, a.id, b.id)).toThrow(/already in use/);
  });

  it('adds item types once and flags unknown ones', () => {
    const { doc, a } = setup();
    expect(addItemType(doc, ' Tool ')).toBe('Tool');
    addItemType(doc, 'Tool');
    expect(doc.itemTypes.filter((t) => t === 'Tool')).toHaveLength(1);
    a.type = 'Nope';
    expect(validateDocument(doc)).toContain(`Item ${a.id}: unknown type 'Nope'`);
  });
});
