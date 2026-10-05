import { describe, expect, it } from 'vitest';
import { addAlignment, addBom, isOccurrence, parentAddress, removeAlignment, removeBom, addFamily, addItem, addItemType, addRelation, itemTypeUsage, removeItemType, renameItemType, migrateItemType, setItemType, setItemTypePrefix, lockedIdPrefix, copyRelation, createDocument, moveRelation, moveRelations, sortedChildren, nextId, parseQty, parseUnit, removeFamily, removeRelation, renameFamily, renameItem, setFamilyValues, validateDocument } from './model';

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

  it('parseUnit clears on blank and keeps the current unit for anything but a whole number of 1 or more', () => {
    expect(parseUnit('1', 5)).toBe(1);
    expect(parseUnit('100', 5)).toBe(100);
    expect(parseUnit('', 5)).toBeUndefined();
    for (const v of ['2.5', 'abc', '0', '-3']) expect(parseUnit(v, 5)).toBe(5);
  });

  it('generates next ids after the highest existing one', () => {
    expect(nextId('R', ['R1', 'R9', 'R10', 'X99'])).toBe('R11');
    expect(nextId('I', [])).toBe('I1');
    expect(nextId('P-', ['P-9', 'PX1', 'I3'])).toBe('P-10');
  });

  it('prefixes new item ids by type', () => {
    const doc = createDocument();
    addItemType(doc, 'Tool');
    expect(addItem(doc, 'Bolt', '', 'Part Revision').id).toBe('P-1');
    expect(addItem(doc, 'Frame', '', 'Design Revision').id).toBe('D-1');
    expect(addItem(doc, 'Nut', '', 'Part Revision')).toMatchObject({ id: 'P-2', type: 'Part Revision' });
    expect(addItem(doc, 'Wrench', '', 'Tool').id).toBe('1'); // no prefix
    expect(addItem(doc, 'Thing').id).toBe('I2'); // I1 is the BOM root
  });

  it('locks the type prefix of item ids that start with it', () => {
    const doc = createDocument();
    const bolt = addItem(doc, 'Bolt', '', 'Part Revision');
    expect(lockedIdPrefix(doc, bolt)).toBe('P-');
    renameItem(doc, bolt.id, 'X1');
    expect(lockedIdPrefix(doc, bolt)).toBe('');
    expect(lockedIdPrefix(doc, doc.items.get('I1')!)).toBe(''); // untyped
  });

  it('swaps the id prefix when an item changes type', () => {
    const doc = createDocument();
    const bolt = addItem(doc, 'Bolt', '', 'Part Revision');
    addItem(doc, 'Frame', '', 'Design Revision');
    setItemType(doc, bolt.id, 'Design Revision');
    expect(bolt).toMatchObject({ id: 'D-2', type: 'Design Revision' }); // D-1 is taken
    setItemType(doc, bolt.id, 'Part Revision');
    expect(bolt.id).toBe('P-2');
    setItemType(doc, bolt.id, undefined);
    expect(bolt.id).toBe('I2');
  });

  it('renames the ids of all items of a type when its prefix changes', () => {
    const { doc, bom, root } = setup();
    const bolt = addItem(doc, 'Bolt', '', 'Part Revision');
    const nut = addItem(doc, 'Nut', '', 'Part Revision');
    const rel = addRelation(doc, bom, root, bolt.id);
    setItemTypePrefix(doc, 'Part Revision', ' PR ');
    expect([bolt.id, nut.id]).toEqual(['PR1', 'PR2']);
    expect(rel.childId).toBe('PR1');
    setItemTypePrefix(doc, 'Part Revision', '');
    expect([bolt.id, nut.id]).toEqual(['1', '2']);
    expect(() => setItemTypePrefix(doc, 'Part Revision', 'P R')).toThrow(/no spaces/);
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
    moveRelation(doc, bom, rel.id, a.id);
    expect(rel).toMatchObject({ parentId: a.id, qty: 3, variantExpr: 'ENGINE=V8', findNo: '10' });
    expect(() => moveRelation(doc, bom, rel.id, b.id)).toThrow(/cycle/);
    expect(rel.parentId).toBe(a.id);
  });

  it('places a moved relation between siblings by find number', () => {
    const { doc, bom, a, b, root } = setup();
    const c = addItem(doc, 'C');
    const [ra, rb, rc] = [a, b, c].map((i) => addRelation(doc, bom, root, i.id)); // 10, 20, 30
    moveRelation(doc, bom, rc.id, root, rb.id);
    expect(rc.findNo).toBe('15');
    rb.findNo = '16';
    moveRelation(doc, bom, ra.id, root, rb.id); // no gap between 15 and 16: renumber
    expect(sortedChildren(bom, root).map((r) => [r.id, r.findNo])).toEqual([
      [rc.id, '10'],
      [ra.id, '20'],
      [rb.id, '30'],
    ]);
  });

  it('moves several relations together, keeping their order', () => {
    const { doc, bom, a, b, root } = setup();
    const [c, d] = [addItem(doc, 'C'), addItem(doc, 'D')];
    const [ra, rb, rc, rd] = [a, b, c, d].map((i) => addRelation(doc, bom, root, i.id)); // 10, 20, 30, 40
    moveRelations(doc, bom, [rc.id, rd.id], root, ra.id, false);
    expect(sortedChildren(bom, root).map((r) => r.id)).toEqual([rc.id, rd.id, ra.id, rb.id]);
    moveRelations(doc, bom, [rc.id, ra.id], root, ra.id, false); // before a moved one: before the next that stays
    expect(sortedChildren(bom, root).map((r) => r.id)).toEqual([rd.id, rc.id, ra.id, rb.id]);
    moveRelations(doc, bom, [rc.id, rd.id], a.id, undefined, false);
    expect(sortedChildren(bom, a.id).map((r) => r.id)).toEqual([rc.id, rd.id]);
    expect(() => moveRelations(doc, bom, [rb.id, ra.id], a.id, undefined, false)).toThrow(/cycle/);
  });

  it('copies several relations together', () => {
    const { doc, bom, a, b, root } = setup();
    const c = addItem(doc, 'C');
    const [ra, rb, rc] = [a, b, c].map((i) => addRelation(doc, bom, root, i.id));
    const copies = moveRelations(doc, bom, [rb.id, rc.id], a.id, undefined, true);
    expect(copies.map((r) => [r.parentId, r.childId])).toEqual([[a.id, b.id], [a.id, c.id]]);
    expect(sortedChildren(bom, root).map((r) => r.id)).toEqual([ra.id, rb.id, rc.id]);
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
    removeRelation(doc, bom, r1.id);
    expect(bom.relations).toHaveLength(2);
    removeRelation(doc, bom, r2.id);
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
    expect(doc.itemTypes.filter((t) => t.name === 'Tool')).toEqual([{ name: 'Tool', prefix: '' }]);
    expect(() => addItemType(doc, 'Jig', 'J -')).toThrow(/no spaces/);
    a.type = 'Nope';
    expect(validateDocument(doc)).toContain(`Item ${a.id}: unknown type 'Nope'`);
  });

  it('renames item types on items and removes only unused ones', () => {
    const { doc, a } = setup();
    expect(doc.itemTypes.map((t) => t.name)).toEqual(['Part Revision', 'Design Revision']);
    a.type = 'Part Revision';
    expect(itemTypeUsage(doc, 'Part Revision')).toBe(1);
    renameItemType(doc, 'Part Revision', ' Component ');
    expect(doc.itemTypes[0]).toEqual({ name: 'Component', prefix: 'P-' });
    expect(a.type).toBe('Component');
    expect(() => renameItemType(doc, 'Component', '')).toThrow(/empty or already used/);
    expect(() => renameItemType(doc, 'Component', 'Design Revision')).toThrow(/empty or already used/);
    expect(() => removeItemType(doc, 'Component')).toThrow(/used by 1 items/);
    removeItemType(doc, 'Design Revision');
    expect(doc.itemTypes.map((t) => t.name)).toEqual(['Component']);
  });

  it('migrates items to another type, renumbering taken ids, and removes the old type', () => {
    const doc = createDocument();
    const p1 = addItem(doc, 'Bolt', '', 'Part Revision');
    const p2 = addItem(doc, 'Nut', '', 'Part Revision');
    addItem(doc, 'Frame', '', 'Design Revision'); // D-1
    expect(migrateItemType(doc, 'Part Revision', 'Design Revision')).toBe(1); // D-1 is taken; Nut keeps its number
    expect([p1, p2].map((i) => [i.id, i.type])).toEqual([['D-3', 'Design Revision'], ['D-2', 'Design Revision']]);
    expect(doc.itemTypes.map((t) => t.name)).toEqual(['Design Revision']);
    expect(() => migrateItemType(doc, 'Design Revision', 'Design Revision')).toThrow(/Cannot migrate/);
  });

  it('adds, renames, sets values of and removes variant families', () => {
    const doc = createDocument();
    expect(addFamily(doc).name).toBe('FAMILY1');
    renameFamily(doc, 'FAMILY1', 'FAMILY2');
    expect(addFamily(doc).name).toBe('FAMILY3');
    expect(() => renameFamily(doc, 'FAMILY3', 'FAMILY2')).toThrow(/already used/);
    expect(() => renameFamily(doc, 'FAMILY3', '')).toThrow(/empty/);
    setFamilyValues(doc, 'FAMILY2', [' A', 'B', '', 'A ']);
    expect(doc.families[0].values).toEqual(['A', 'B']);
    removeFamily(doc, 'FAMILY2');
    expect(doc.families.map((f) => f.name)).toEqual(['FAMILY3']);
  });

  it('rejects double quotes in family names and values, also on load', () => {
    const doc = createDocument();
    addFamily(doc);
    expect(() => renameFamily(doc, 'FAMILY1', 'A"B')).toThrow(/cannot contain/);
    expect(() => setFamilyValues(doc, 'FAMILY1', ['X', 'Y"'])).toThrow(/cannot contain/);
    doc.families[0].values = ['"V6"'];
    expect(validateDocument(doc)).toEqual([`Variant family FAMILY1: names and values cannot contain '"'`]);
  });

  it('updates variant expressions in all BOMs when a family or value is renamed', () => {
    const { doc, bom, a, b, root } = setup();
    const other = addBom(doc, 'Other', 'MBOM', root);
    doc.families.push({ name: 'ENGINE', values: ['V6', 'V8'] }, { name: 'MARKET', values: ['V6'] });
    const r1 = addRelation(doc, bom, root, a.id);
    const r2 = addRelation(doc, other, root, b.id);
    r1.variantExpr = 'ENGINE=V6 AND MARKET=V6';
    r2.variantExpr = 'ENGINE IN (V8, V6)';

    renameFamily(doc, 'ENGINE', 'Engine type');
    expect([r1.variantExpr, r2.variantExpr]).toEqual(['"Engine type"=V6 AND MARKET=V6', '"Engine type" IN (V8, V6)']);

    expect(setFamilyValues(doc, 'Engine type', ['V6 Turbo', 'V8'])).toEqual(new Map([['V6', 'V6 Turbo']]));
    expect([r1.variantExpr, r2.variantExpr]).toEqual(['"Engine type"="V6 Turbo" AND MARKET=V6', '"Engine type" IN (V8, "V6 Turbo")']);

    // Reordering, adding or removing values renames nothing.
    for (const values of [['V8', 'V6 Turbo'], ['V8', 'V6 Turbo', 'EV'], ['V8']]) {
      expect(setFamilyValues(doc, 'Engine type', values).size).toBe(0);
    }
    expect(r2.variantExpr).toBe('"Engine type" IN (V8, "V6 Turbo")');
  });
});

/** EBOM: root → A (R1) → B (R2); MBOM: root → B (R3). A1 links the two B occurrences. */
function alignedSetup() {
  const { doc, bom, a, b, root } = setup();
  const r1 = addRelation(doc, bom, root, a.id);
  const r2 = addRelation(doc, bom, a.id, b.id);
  const mbom = addBom(doc, 'M', 'MBOM', root);
  const r3 = addRelation(doc, mbom, root, b.id);
  const ebomB = `${bom.id}:${r1.id}/${r2.id}`;
  const mbomB = `${mbom.id}:${r3.id}`;
  addAlignment(doc, ebomB, mbomB);
  return { doc, bom, mbom, a, b, root, r1, r2, r3, ebomB, mbomB };
}

describe('alignments', () => {
  it('parentAddress drops the last relation id', () => {
    expect(parentAddress('EBOM:R3/R5')).toBe('EBOM:R3');
    expect(parentAddress('EBOM:R3')).toBe('EBOM:');
    expect(parentAddress('EBOM:')).toBe('EBOM:');
  });

  it('isOccurrence follows the relation chain from the root', () => {
    const { doc, bom, r1, r2, r3, ebomB } = alignedSetup();
    expect(isOccurrence(doc, ebomB)).toBe(true);
    expect(isOccurrence(doc, `${bom.id}:`)).toBe(true);
    expect(isOccurrence(doc, `${bom.id}:${r2.id}`)).toBe(false); // R2 is not under the root
    expect(isOccurrence(doc, `${bom.id}:${r3.id}`)).toBe(false); // R3 is in the other BOM
    expect(isOccurrence(doc, `NOPE:${r1.id}`)).toBe(false);
    expect(isOccurrence(doc, `${bom.id}:R99`)).toBe(false);
  });

  it('adds and removes alignments, rejecting duplicates, same-BOM pairs and non-occurrences', () => {
    const { doc, bom, r1, ebomB, mbomB } = alignedSetup();
    expect(doc.alignments).toEqual([{ id: 'A1', source: ebomB, target: mbomB }]);
    expect(() => addAlignment(doc, ebomB, mbomB)).toThrow(/Already aligned/);
    expect(() => addAlignment(doc, mbomB, ebomB)).toThrow(/Already aligned/);
    expect(() => addAlignment(doc, ebomB, `${bom.id}:${r1.id}`)).toThrow(/same BOM/);
    expect(() => addAlignment(doc, ebomB, `${bom.id}:R99`)).toThrow(/occurrences/);
    expect(addAlignment(doc, `${bom.id}:${r1.id}`, mbomB).id).toBe('A2');
    removeAlignment(doc, 'A1');
    expect(doc.alignments.map((a) => a.id)).toEqual(['A2']);
  });

  it('removing a relation removes alignments in its subtree and keeps the others', () => {
    const { doc, bom, mbom, a, root, r1, r3 } = alignedSetup();
    const ra = addRelation(doc, mbom, root, a.id);
    addAlignment(doc, `${bom.id}:${r1.id}`, `${mbom.id}:${ra.id}`);
    removeRelation(doc, mbom, r3.id);
    expect(doc.alignments.map((x) => x.id)).toEqual(['A2']);
    // Removing R1 orphans A, so its own relation R2 goes too; A2 ends at R1.
    removeRelation(doc, bom, r1.id);
    expect(doc.alignments).toEqual([]);
  });

  it('moving a relation removes the alignments of its subtree', () => {
    const { doc, bom, root, r2 } = alignedSetup();
    moveRelation(doc, bom, r2.id, root);
    expect(doc.alignments).toEqual([]);
  });

  it('removing a BOM removes its alignments and keeps the items, but not the last BOM', () => {
    const { doc, bom, mbom, a, b } = alignedSetup();
    removeBom(doc, mbom.id);
    expect(doc.boms).toEqual([bom]);
    expect(doc.alignments).toEqual([]);
    expect(doc.items.has(a.id) && doc.items.has(b.id)).toBe(true);
    expect(() => removeBom(doc, bom.id)).toThrow(/at least one BOM/);
  });
});
