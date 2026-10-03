import { isEffective, type EffectivityContext } from './effectivity';
import { evaluate, parse, type OptionConfig } from './expr';
import { occurrencePath, sortedChildren, type Bom, type BomDocument, type Item, type Relation } from './model';

export type Status = 'included' | 'excludedByVariant' | 'excludedByEff' | 'excludedByParent';

export interface ConfigContext extends EffectivityContext {
  enabled: boolean;
  options: OptionConfig;
}

export interface Occurrence {
  address: string;
  path: string[]; // relation ids from the root
  item: Item;
  relation?: Relation; // undefined for the root
  status: Status;
  reason?: string;
  children: Occurrence[];
}

/** Expands the BOM into its occurrence tree and marks what the configuration excludes. */
export function resolve(doc: BomDocument, bom: Bom, ctx: ConfigContext): Occurrence {
  const build = (item: Item, relation: Relation | undefined, path: string[], parentIncluded: boolean): Occurrence => {
    const occ: Occurrence = {
      address: occurrencePath(bom.id, path),
      path,
      item,
      relation,
      status: 'included',
      children: [],
    };
    if (relation && ctx.enabled) Object.assign(occ, judge(relation, ctx, parentIncluded));
    const included = occ.status === 'included';
    occ.children = sortedChildren(bom, item.id).map((r) => build(doc.items.get(r.childId)!, r, [...path, r.id], included));
    return occ;
  };
  return build(doc.items.get(bom.rootId)!, undefined, [], true);
}

function judge(rel: Relation, ctx: ConfigContext, parentIncluded: boolean): Pick<Occurrence, 'status' | 'reason'> {
  if (!parentIncluded) return { status: 'excludedByParent', reason: 'Parent is excluded' };
  const { ast, errors } = parse(rel.variantExpr);
  if (errors.length) return { status: 'excludedByVariant', reason: `Invalid variant expression: ${errors[0].message}` };
  if (!evaluate(ast, ctx.options)) return { status: 'excludedByVariant', reason: `Variant false: ${rel.variantExpr}` };
  if (!isEffective(rel.eff, ctx)) return { status: 'excludedByEff', reason: 'Not effective for date/unit' };
  return { status: 'included' };
}
