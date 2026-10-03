import { describe, expect, it } from 'vitest';
import { resolve, type ConfigContext, type Occurrence } from './resolve';
import { parseXml } from './xml';
import sample from './samples/car.xml?raw';

const doc = parseXml(sample);
const ebom = doc.boms.find((b) => b.id === 'EBOM')!;

function flatten(o: Occurrence): Occurrence[] {
  return [o, ...o.children.flatMap(flatten)];
}
function statuses(ctx: ConfigContext): Record<string, string> {
  return Object.fromEntries(flatten(resolve(doc, ebom, ctx)).map((o) => [o.address, o.status]));
}

describe('resolve', () => {
  it('gives each occurrence of a reused item its own address', () => {
    const bolts = flatten(resolve(doc, ebom, { enabled: false, options: {} })).filter((o) => o.item.id === 'I12');
    expect(bolts.map((o) => o.address).sort()).toEqual(['EBOM:R1/R12', 'EBOM:R2/R10/R11']);
  });

  it('includes everything when configuration is off', () => {
    expect(new Set(Object.values(statuses({ enabled: false, options: {} })))).toEqual(new Set(['included']));
  });

  it('applies variant and effectivity rules', () => {
    const s = statuses({ enabled: true, options: { ENGINE: 'EV', MARKET: 'EU' }, date: '2026-10-01', unit: 50 });
    expect(s['EBOM:R3/R7']).toBe('included'); // electric motor
    expect(s['EBOM:R3/R8']).toBe('excludedByEff'); // battery from unit 100
    expect(s['EBOM:R3/R5']).toBe('excludedByVariant'); // V6
    expect(s['EBOM:R3/R9']).toBe('excludedByVariant'); // gearbox NOT EV
  });

  it('marks descendants of excluded occurrences', () => {
    const custom = structuredClone(doc);
    const bom = custom.boms.find((b) => b.id === 'EBOM')!;
    bom.relations.find((r) => r.id === 'R2')!.variantExpr = 'ENGINE=V8';
    const s = Object.fromEntries(
      flatten(resolve(custom, bom, { enabled: true, options: { ENGINE: 'V6' } })).map((o) => [o.address, o.status]),
    );
    expect(s['EBOM:R2']).toBe('excludedByVariant');
    expect(s['EBOM:R2/R10/R11']).toBe('excludedByParent');
  });
});
