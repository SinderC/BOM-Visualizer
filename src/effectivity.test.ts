import { describe, expect, it } from 'vitest';
import { formatEff, isEffective } from './effectivity';

describe('effectivity', () => {
  const eff = { dateFrom: '2026-01-01', dateTo: '2026-12-31', unitFrom: 10, unitTo: 50 };

  it('uses inclusive bounds', () => {
    expect(isEffective(eff, { date: '2026-01-01', unit: 10 })).toBe(true);
    expect(isEffective(eff, { date: '2026-12-31', unit: 50 })).toBe(true);
    expect(isEffective(eff, { date: '2025-12-31' })).toBe(false);
    expect(isEffective(eff, { date: '2027-01-01' })).toBe(false);
    expect(isEffective(eff, { unit: 9 })).toBe(false);
    expect(isEffective(eff, { unit: 51 })).toBe(false);
  });

  it('treats open ends as unbounded and skips dimensions missing from the context', () => {
    expect(isEffective({ unitFrom: 10 }, { unit: 1_000_000 })).toBe(true);
    expect(isEffective({ dateTo: '2026-01-01' }, { date: '1990-01-01' })).toBe(true);
    expect(isEffective(eff, {})).toBe(true);
  });

  it('formats a short label', () => {
    expect(formatEff({})).toBe('');
    expect(formatEff({ dateFrom: '2026-01-01', unitFrom: 10 })).toBe('2026-01-01→ · U10–UP');
    expect(formatEff({ dateTo: '2026-06-30', unitTo: 5 })).toBe('…→2026-06-30 · U1–5');
  });
});
