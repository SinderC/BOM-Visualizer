import { describe, expect, it } from 'vitest';
import { parseXml, serializeXml } from './xml';
import sample from './samples/car.xml?raw';

describe('xml', () => {
  it('parses the sample with multiple BOMs and alignments', () => {
    const doc = parseXml(sample);
    expect(doc.boms.map((b) => b.id)).toEqual(['EBOM', 'MBOM']);
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
    doc.items.get('I1')!.name = 'A & B <"x">';
    expect(parseXml(serializeXml(doc)).items.get('I1')!.name).toBe('A & B <"x">');
  });

  it('ignores unknown elements and attributes', () => {
    const xml = sample.replace('<items>', '<futureThing foo="1"/><items>').replace('<item id="I2"', '<item extra="y" id="I2"');
    expect(parseXml(xml).items.get('I2')!.name).toBe('Body');
  });

  it('rejects bad input', () => {
    expect(() => parseXml('<nope')).toThrow(/well-formed/);
    expect(() => parseXml('<other/>')).toThrow(/bomDocument/);
    expect(() => parseXml(sample.replace('version="1"', 'version="2"'))).toThrow(/version 2/);
    expect(() => parseXml(sample.replace('id="R2"', 'id="R1"'))).toThrow(/Duplicate relation id R1/);
    expect(() => parseXml(sample.replace('child="I15"', 'child="I99"'))).toThrow(/I99 does not exist/);
    expect(() => parseXml(sample.replace('parent="I9" child="I12"', 'parent="I9" child="I1"'))).toThrow(/cycle/);
  });
});
