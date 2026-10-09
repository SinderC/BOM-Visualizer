import { describe, expect, it } from 'vitest';
import { DEFAULT_ITEM_TYPES, DEFAULT_UOMS } from './model';
import { parseXml, serializeXml } from './xml';
import sample from './samples/car.xml?raw';

describe('xml', () => {
  it('parses the sample with multiple BOMs and alignments', () => {
    const doc = parseXml(sample);
    expect(doc.boms.map((b) => b.id)).toEqual(['EBOM', 'MBOM']);
    expect(doc.boms.map((b) => b.type)).toEqual(['EBOM', 'MBOM']);
    expect(doc.alignments).toEqual([
      { id: 'A1', source: 'EBOM:R3/R5', target: 'MBOM:R22/R23' },
      { id: 'A2', source: 'EBOM:R2/R10', target: 'MBOM:R26/R27' },
    ]);
    const r8 = doc.boms[0].relations.find((r) => r.id === 'R8')!;
    expect(r8.eff.unitFrom).toBe(100);
    expect(r8.variantExpr).toBe('ENGINE=EV');
  });

  it('round-trips', () => {
    const doc = parseXml(sample);
    const again = parseXml(serializeXml(doc));
    expect(again).toEqual(doc);
    expect(serializeXml(again)).toBe(serializeXml(doc));
  });

  it('escapes special characters', () => {
    const doc = parseXml(sample);
    doc.items.get('A-1')!.name = 'A & B <"x">';
    expect(parseXml(serializeXml(doc)).items.get('A-1')!.name).toBe('A & B <"x">');
  });

  it('ignores unknown elements and attributes', () => {
    const xml = sample.replace('<items>', '<futureThing foo="1"/><items>').replace('<item id="A-2"', '<item extra="y" id="A-2"');
    expect(parseXml(xml).items.get('A-2')!.name).toBe('Body');
  });

  it('reads item types and falls back to defaults for older files', () => {
    const doc = parseXml(sample);
    expect(doc.items.get('S-1')!.type).toBe('Station');
    expect(doc.itemTypes[2]).toEqual({ name: 'Station', prefix: 'S-' });
    const unprefixed = parseXml(sample.replace(/ prefix="[^"]*"/g, ''));
    expect(unprefixed.itemTypes[0]).toEqual({ name: 'Part', prefix: 'P-' }); // first letter, as ids were generated then
    doc.itemTypes[0].prefix = '';
    expect(parseXml(serializeXml(doc)).itemTypes[0].prefix).toBe('');
    const old = sample.replace(/<itemTypes>[\s\S]*<\/itemTypes>/, '').replace(/ type="(Part|Assembly|Station)"/g, '');
    const legacy = parseXml(old);
    expect(legacy.itemTypes).toEqual(DEFAULT_ITEM_TYPES);
    expect(legacy.items.get('S-1')!.type).toBeUndefined();
  });

  it('reads units and falls back to defaults for older files', () => {
    const doc = parseXml(sample);
    expect(doc.items.get('P-11')!.uom).toBe('l');
    expect(doc.items.get('P-1')!.uom).toBeUndefined();
    expect(parseXml(sample.replace('<item id="P-1" type="Part"', '<item id="P-1" type="Part" uom="each"')).items.get('P-1')!.uom).toBeUndefined();
    doc.uoms = [];
    doc.items.get('P-11')!.uom = doc.items.get('P-12')!.uom = undefined;
    expect(parseXml(serializeXml(doc)).uoms).toEqual([]);
    const legacy = parseXml(sample.replace(/<uoms>[\s\S]*<\/uoms>/, '').replace(/ uom="[^"]*"/g, ''));
    expect(legacy.uoms).toEqual(DEFAULT_UOMS);
    expect(() => parseXml(sample.replace('<uom>l</uom>', ''))).toThrow(/P-11: unknown unit 'l'/);
  });

  it('round-trips an A/R qty', () => {
    const doc = parseXml(sample.replace('qty="1" findNo="10"', 'qty="A/R" findNo="10"'));
    expect(doc.boms[0].relations.find((r) => r.id === 'R1')?.qty).toBe('A/R');
    expect(parseXml(serializeXml(doc))).toEqual(doc);
  });

  it('accepts a BOM without a type', () => {
    expect(parseXml(sample.replace(' type="EBOM"', '')).boms[0].type).toBeUndefined();
  });

  it('rejects bad input', () => {
    expect(() => parseXml('<nope')).toThrow(/well-formed/);
    expect(() => parseXml('<other/>')).toThrow(/bomDocument/);
    expect(() => parseXml(sample.replace('qty="1" findNo="10"', 'qty="-1" findNo="10"'))).toThrow(/R1: invalid qty/);
    expect(() => parseXml(sample.replace('unitFrom="100"', 'unitFrom="0"'))).toThrow(/unitFrom must be a whole number of 1 or more/);
    expect(() => parseXml(sample.replace('version="1"', 'version="2"'))).toThrow(/version 2/);
    expect(() => parseXml(sample.replace('type="EBOM"', 'type="XBOM"'))).toThrow(/unknown type 'XBOM'/);
    expect(() => parseXml(sample.replace('<type prefix="S-">Station</type>', ''))).toThrow(/unknown type 'Station'/);
    expect(() => parseXml(sample.replace('id="R2"', 'id="R1"'))).toThrow(/Duplicate relation id R1/);
    expect(() => parseXml(sample.replace('child="A-5"', 'child="I99"'))).toThrow(/I99 does not exist/);
    expect(() => parseXml(sample.replace('parent="P-5" child="P-8"', 'parent="P-5" child="A-1"'))).toThrow(/cycle/);
  });
});
