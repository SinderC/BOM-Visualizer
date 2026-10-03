import { describe, expect, it } from 'vitest';
import { addItem, addRelation, createDocument, nextId, removeRelation, validateDocument } from './model';

function setup() {
  const doc = createDocument();
  const bom = doc.boms[0];
  const a = addItem(doc, 'A');
  const b = addItem(doc, 'B');
  return { doc, bom, a, b, root: bom.rootId };
}

describe('model', () => {
  it('generates next ids after the highest existing one', () => {
    expect(nextId('R', ['R1', 'R9', 'R10', 'X99'])).toBe('R11');
    expect(nextId('I', [])).toBe('I1');
  });

  it('assigns increasing find numbers', () => {
    const { doc, bom, a, b, root } = setup();
    expect(addRelation(doc, bom, root, a.id).findNo).toBe('10');
    expect(addRelation(doc, bom, root, b.id).findNo).toBe('20');
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
});
