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

/** Short label such as `2026-01-01→ · U10–UP`; empty when unconstrained. */
export function formatEff(eff: Effectivity): string {
  const parts: string[] = [];
  if (eff.dateFrom || eff.dateTo) parts.push(`${eff.dateFrom ?? '…'}→${eff.dateTo ?? ''}`);
  if (eff.unitFrom !== undefined || eff.unitTo !== undefined) {
    parts.push(`U${eff.unitFrom ?? 1}–${eff.unitTo ?? 'UP'}`);
  }
  return parts.join(' · ');
}
