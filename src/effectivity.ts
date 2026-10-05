import type { Effectivity } from './model';

export interface EffectivityContext {
  date?: string; // ISO yyyy-mm-dd
  unit?: number;
}

/** Inclusive ranges; open ends are unbounded. A dimension missing from the context is not checked. */
export function isEffective(eff: Effectivity, ctx: EffectivityContext): boolean {
  if (ctx.date) {
    // ISO dates compare correctly as strings.
    if (eff.dateFrom && ctx.date < eff.dateFrom) return false;
    if (eff.dateTo && ctx.date > eff.dateTo) return false;
  }
  if (ctx.unit !== undefined) {
    if (eff.unitFrom !== undefined && ctx.unit < eff.unitFrom) return false;
    if (eff.unitTo !== undefined && ctx.unit > eff.unitTo) return false;
  }
  return true;
}

/** One end of the effectivity: its date and/or unit, joined by ` · ` when a relation has both; empty when open. */
export function formatEffEnd(eff: Effectivity, end: 'from' | 'to'): string {
  const [date, unit] = end === 'from' ? [eff.dateFrom, eff.unitFrom] : [eff.dateTo, eff.unitTo];
  return [date, unit?.toString()].filter(Boolean).join(' · ');
}
