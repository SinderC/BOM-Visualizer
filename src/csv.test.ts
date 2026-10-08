import { describe, expect, it } from 'vitest';
import { importCsv, parseCsv } from './csv';
import { serializeXml, parseXml } from './xml';
import sample from './samples/car.xml?raw';

const EXAMPLE = `Parent,ID,Name,Type,Description,Qty,FindNo,Variant,EffDateFrom,EffDateTo,EffUnitFrom,EffUnitTo
,A-100,Chassis,Assembly,Rolling chassis,,,,,,,
A-100,P-200,Wheel,Part,,4,10,,,,,
P-200,P-300,Wheel bolt,Part,M12x1.5,5,10,,,,,
A-100,P-400,Engine V8,Part,,1,20,ENGINE=V8,2026-01-01,,,
A-100,P-410,Engine V6,Part,,1,20,"ENGINE=V6 AND MARKET IN (EU, US)",,2027-06-30,10,UP
A-100,P-300,Wheel bolt,Part,,8,,,,,,
`;

/** Imports `csv` into the sample and returns the error message, checking that the sample is left unchanged. */
function importError(csv: string): string {
  const doc = parseXml(sample);
  const result = importCsv(doc, csv, 'X');
  expect(serializeXml(doc)).toBe(serializeXml(parseXml(sample)));
  return 'errors' in result ? result.errors.join('\n') : '';
}

/** Imports `csv` into the sample, expecting no errors. */
function imported(csv: string) {
  const doc = parseXml(sample);
  const result = importCsv(doc, csv, 'X');
  if ('errors' in result) throw new Error(result.errors.join('\n'));
  return { before: doc, ...result };
}

describe('csv', () => {
  it('parses quoted fields, escaped quotes, CRLF and a byte order mark', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });

  it('detects a semicolon delimiter from the header', () => {
    expect(parseCsv('a;b\n1,5;2')).toEqual([
      ['a', 'b'],
      ['1,5', '2'],
    ]);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseCsv('a\n"x')).toThrow('not closed');
  });

  it('imports the example into a new BOM on a copy of the document', () => {
    const { before: doc, doc: out, bom, reused } = imported(EXAMPLE);
    expect(reused.size).toBe(0);
    expect(out.boms.at(-1)).toBe(bom);
    expect(doc.boms).toHaveLength(out.boms.length - 1);
    expect(bom).toMatchObject({ name: 'X', rootId: 'A-100' });
    expect(out.items.get('P-300')).toEqual({ id: 'P-300', name: 'Wheel bolt', description: 'M12x1.5', type: 'Part' });
    expect(bom.relations.map((r) => [r.parentId, r.childId, r.qty, r.findNo])).toEqual([
      ['A-100', 'P-200', 4, '10'],
      ['P-200', 'P-300', 5, '10'],
      ['A-100', 'P-400', 1, '20'],
      ['A-100', 'P-410', 1, '20'],
      ['A-100', 'P-300', 8, '30'], // blank find number: next after the highest
    ]);
    expect(bom.relations[3]).toMatchObject({ variantExpr: 'ENGINE=V6 AND MARKET IN (EU, US)', eff: { dateTo: '2027-06-30', unitFrom: 10 } });
    expect(bom.relations[3].eff.unitTo).toBeUndefined();
    expect(bom.relations[2].eff).toEqual({ dateFrom: '2026-01-01' });
    expect(() => parseXml(serializeXml(out))).not.toThrow();
  });

  it('reuses items already in the document without changing them', () => {
    const { before, doc: out, bom, reused } = imported('id;parent;name\nA-1;;Renamed\nP-1;A-1;Other\n');
    expect(reused).toEqual(new Set(['A-1', 'P-1']));
    expect(out.items.size).toBe(before.items.size);
    expect(out.items.get('A-1')).toEqual(before.items.get('A-1'));
    expect(out.items.get('A-1')!.name).toBe('Car');
    expect(bom.relations).toHaveLength(1);
  });

  it('matches header names ignoring case and separators', () => {
    const { bom } = imported('PARENT,Id,Find No.\n,A-1,\nA-1,P-1,7\n');
    expect(bom.relations[0].findNo).toBe('7');
  });

  it('needs Parent and ID columns', () => {
    expect(importError('Name,ID\n,A-1\n')).toBe('The CSV header needs Parent and ID columns');
  });

  it('needs exactly one root and known parents', () => {
    expect(importError('Parent,ID\n,A\n,B\n')).toContain('found 2');
    expect(importError('Parent,ID\nA,B\n')).toContain('found 0');
    expect(importError('Parent,ID\n,A\nZ,B\nA,\n')).toBe(['Row 3: parent Z is not the ID of any row', 'Row 4: ID is empty'].join('\n'));
  });

  it('lists missing item types and variant values, and creates them when asked', () => {
    const csv = [
      'Parent,ID,Type,Variant',
      ',G-1,Gizmo,COLOR=RED',
      'G-1,G-10,Gizmo,"COLOR IN (RED, BLUE) AND ENGINE=V12"',
      'G-1,G-11,Gizmo,ENGINE=V12 OR TRIM=BASE',
      'G-1,P-1,Widget,MARKET=',
    ].join('\n');
    const doc = parseXml(sample);
    const missing = { types: [{ name: 'Gizmo', prefix: 'G-' }], uoms: [], values: new Map([['COLOR', ['RED', 'BLUE']], ['ENGINE', ['V12']]]) };
    const rejected = importCsv(doc, csv, 'X');
    expect(rejected.missing).toEqual(missing); // not RED from the root row, not Widget for existing P-1
    expect('errors' in rejected && rejected.errors).toEqual([
      "Row 2: unknown type 'Gizmo' (known: Part, Assembly, Station)",
      "Row 3: unknown type 'Gizmo' (known: Part, Assembly, Station)",
      "Row 3: variant: Unknown variant family 'COLOR'",
      "Row 3: variant: 'V12' is not a value of ENGINE",
      "Row 4: unknown type 'Gizmo' (known: Part, Assembly, Station)",
      "Row 4: variant: 'V12' is not a value of ENGINE",
      "Row 5: variant: Expected value but found 'end of expression'",
    ]);
    const created = importCsv(doc, csv.replace('MARKET=', 'MARKET=EU'), 'X', true);
    if ('errors' in created) throw new Error(created.errors.join('\n'));
    expect(created.doc.itemTypes.at(-1)).toEqual({ name: 'Gizmo', prefix: 'G-' });
    expect(created.doc.families.find((f) => f.name === 'ENGINE')!.values).toEqual(['V6', 'V8', 'EV', 'V12']);
    expect(created.doc.families.at(-1)).toEqual({ name: 'COLOR', values: ['RED', 'BLUE'] });
    expect(doc.families.map((f) => f.name)).toEqual(['ENGINE', 'MARKET', 'TRIM']);
  });

  it('sets units of new items, and lists missing ones and creates them when asked', () => {
    const csv = ['Parent,ID,UoM', ',A-1,', 'A-1,X-1,kg', 'A-1,X-2,each', 'A-1,X-3,pallet', 'A-1,P-1,crate'].join('\n');
    const doc = parseXml(sample);
    const rejected = importCsv(doc, csv, 'X');
    expect(rejected.missing.uoms).toEqual(['pallet']); // not crate for existing P-1
    expect('errors' in rejected && rejected.errors).toEqual(["Row 5: unknown unit 'pallet' (known: each, kg, g, m, mm, m², l)"]);
    const created = importCsv(doc, csv, 'X', true);
    if ('errors' in created) throw new Error(created.errors.join('\n'));
    expect(['X-1', 'X-2', 'X-3', 'P-1'].map((id) => created.doc.items.get(id)!.uom)).toEqual(['kg', undefined, 'pallet', undefined]);
    expect(created.doc.uoms.at(-1)).toBe('pallet');
    expect(doc.uoms).not.toContain('pallet');
  });

  it('gives a new type the ID start its items share, up to a digit or space', () => {
    const prefix = (ids: string[]) => importCsv(parseXml(sample), ['Parent,ID,Type', ',A-1,', ...ids.map((id) => `A-1,${id},New`)].join('\n'), 'X').missing.types[0].prefix;
    expect(prefix(['GZ-7'])).toBe('GZ-');
    expect(prefix(['X1', 'Y2'])).toBe('');
    expect(prefix(['G-100', 'G-200'])).toBe('G-');
  });

  it('rejects unknown types', () => {
    expect(importError('Parent,ID,Type\n,A,Gizmo\n')).toBe("Row 2: unknown type 'Gizmo' (known: Part, Assembly, Station)");
  });

  it('reports structure and field problems together, sorted by row', () => {
    expect(importError('Parent,ID,Qty\nZ,B,x\n,A,\n,C,\n')).toBe(
      ['Exactly one row needs a blank Parent (the root); found 2', 'Row 2: parent Z is not the ID of any row', "Row 2: Qty 'x' must be a number of 0 or more"].join('\n'),
    );
  });

  it('reports every bad relation field and cycle, by row', () => {
    const csv = [
      'Parent,ID,Qty,Variant,EffDateFrom,EffUnitTo',
      ',A,,,,',
      'A,B,-1,,,',
      'A,C,,ENGINE=V12,,',
      'A,D,,,2026-02-30,0',
      'A,E,,,,',
      'E,A,,,,',
    ].join('\n');
    expect(importError(csv)).toBe(
      [
        "Row 3: Qty '-1' must be a number of 0 or more",
        "Row 4: variant: 'V12' is not a value of ENGINE",
        "Row 5: EffDateFrom '2026-02-30' must be a yyyy-mm-dd date",
        "Row 5: EffUnitTo '0' must be a whole number of 1 or more",
        'Row 7: Adding A under E would create a cycle',
      ].join('\n'),
    );
  });
});
