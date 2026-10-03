import { describe, expect, it } from 'vitest';
import { DEFAULT_ITEM_TYPES } from './model';
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
    const old = sample.replace(/<itemTypes>[\s\S]*<\/itemTypes>/, '').replace(/ type="(Part|Assembly|Station)"/g, '');
    const legacy = parseXml(old);
    expect(legacy.itemTypes).toEqual(DEFAULT_ITEM_TYPES);
    expect(legacy.items.get('S-1')!.type).toBeUndefined();
  });

  it('accepts a BOM without a type', () => {
    expect(parseXml(sample.replace(' type="EBOM"', '')).boms[0].type).toBeUndefined();
  });

  it('rejects bad input', () => {
    expect(() => parseXml('<nope')).toThrow(/well-formed/);
    expect(() => parseXml('<other/>')).toThrow(/bomDocument/);
    expect(() => parseXml(sample.replace('version="1"', 'version="2"'))).toThrow(/version 2/);
    expect(() => parseXml(sample.replace('type="EBOM"', 'type="XBOM"'))).toThrow(/unknown type 'XBOM'/);
    expect(() => parseXml(sample.replace('<type>Station</type>', ''))).toThrow(/unknown type 'Station'/);
    expect(() => parseXml(sample.replace('id="R2"', 'id="R1"'))).toThrow(/Duplicate relation id R1/);
    expect(() => parseXml(sample.replace('child="A-5"', 'child="I99"'))).toThrow(/I99 does not exist/);
    expect(() => parseXml(sample.replace('parent="P-5" child="P-8"', 'parent="P-5" child="A-1"'))).toThrow(/cycle/);
  });
});
