import type { OptionFamily } from './model';

/**
 * Variant expression language.
 *
 *   or      := and ('OR' and)*
 *   and     := not ('AND' not)*
 *   not     := 'NOT' not | primary
 *   primary := '(' or ')' | NAME ('=' | '!=') NAME | NAME 'IN' '(' NAME (',' NAME)* ')'
 *   NAME    := [A-Za-z0-9_.-]+ | '"' any character but '"' '"'
 *
 * Keywords are case-insensitive; family and value names are case-sensitive. Names with other characters, such as
 * spaces, or that are keywords are written in double quotes: `"Engine type" = "V6 Turbo"`.
 */

/** A family or value name in an expression; `pos`..`end` is its source text, quotes included. */
export interface Name {
  name: string;
  pos: number;
  end: number;
}

export type Expr =
  | { kind: 'or'; items: Expr[] }
  | { kind: 'and'; items: Expr[] }
  | { kind: 'not'; expr: Expr }
  /** `=` and `IN` both mean "value is one of"; `!=` is negated. */
  | { kind: 'cmp'; family: Name; negate: boolean; values: Name[] };

export interface ExprError {
  message: string;
  pos: number;
}

/** Selected value per family; a missing family means "no value selected". */
export type OptionConfig = Record<string, string | undefined>;

type Cmp = Extract<Expr, { kind: 'cmp' }>;

type Token = { pos: number; end: number } & (
  | { type: 'ident'; text: string; quoted: boolean }
  | { type: 'op'; text: '(' | ')' | ',' | '=' | '!=' }
  | { type: 'end' }
);

const KEYWORDS = ['AND', 'OR', 'NOT', 'IN'];

class ExprSyntaxError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

/** With `lenient`, for completion, unknown characters are skipped and an unterminated quote runs to the end. */
function tokenize(src: string, lenient = false): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '!' && src[i + 1] === '=') {
      tokens.push({ type: 'op', text: '!=', pos: i, end: i + 2 });
      i += 2;
    } else if ('(),='.includes(ch)) {
      tokens.push({ type: 'op', text: ch as '(' | ')' | ',' | '=', pos: i, end: i + 1 });
      i++;
    } else if (ch === '"') {
      const close = src.indexOf('"', i + 1);
      if (close < 0 && !lenient) throw new ExprSyntaxError(`Missing closing '"'`, i);
      const end = close < 0 ? src.length : close + 1;
      tokens.push({ type: 'ident', text: src.slice(i + 1, close < 0 ? end : close), quoted: true, pos: i, end });
      i = end;
    } else if (/[\w.-]/.test(ch)) {
      const start = i;
      while (i < src.length && /[\w.-]/.test(src[i])) i++;
      tokens.push({ type: 'ident', text: src.slice(start, i), quoted: false, pos: start, end: i });
    } else if (lenient) {
      i++;
    } else {
      throw new ExprSyntaxError(`Unexpected character '${ch}'`, i);
    }
  }
  tokens.push({ type: 'end', pos: src.length, end: src.length });
  return tokens;
}

/** The token's keyword in upper case, if it is one; a quoted name never is. */
function keyword(t: Token): string | undefined {
  if (t.type !== 'ident' || t.quoted) return undefined;
  const upper = t.text.toUpperCase();
  return KEYWORDS.includes(upper) ? upper : undefined;
}

/** A name as written in an expression: quoted unless it is a plain word that is not a keyword. */
export function quoteName(name: string): string {
  return /^[\w.-]+$/.test(name) && !KEYWORDS.includes(name.toUpperCase()) ? name : `"${name}"`;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  parse(): Expr {
    const expr = this.or();
    const t = this.peek();
    if (t.type !== 'end') throw new ExprSyntaxError(`Unexpected '${describe(t)}'`, t.pos);
    return expr;
  }

  private peek(): Token {
    return this.tokens[this.i];
  }

  private isKeyword(kw: string): boolean {
    return keyword(this.peek()) === kw;
  }

  private isOp(op: string): boolean {
    const t = this.peek();
    return t.type === 'op' && t.text === op;
  }

  private expectOp(op: string): void {
    if (!this.isOp(op)) {
      const t = this.peek();
      throw new ExprSyntaxError(`Expected '${op}' but found '${describe(t)}'`, t.pos);
    }
    this.i++;
  }

  private name(what: string): Name {
    const t = this.peek();
    if (t.type !== 'ident' || keyword(t)) {
      throw new ExprSyntaxError(`Expected ${what} but found '${describe(t)}'`, t.pos);
    }
    this.i++;
    return { name: t.text, pos: t.pos, end: t.end };
  }

  private or(): Expr {
    const items = [this.and()];
    while (this.isKeyword('OR')) {
      this.i++;
      items.push(this.and());
    }
    return items.length === 1 ? items[0] : { kind: 'or', items };
  }

  private and(): Expr {
    const items = [this.not()];
    while (this.isKeyword('AND')) {
      this.i++;
      items.push(this.not());
    }
    return items.length === 1 ? items[0] : { kind: 'and', items };
  }

  private not(): Expr {
    if (this.isKeyword('NOT')) {
      this.i++;
      return { kind: 'not', expr: this.not() };
    }
    return this.primary();
  }

  private primary(): Expr {
    if (this.isOp('(')) {
      this.i++;
      const expr = this.or();
      this.expectOp(')');
      return expr;
    }
    const family = this.name('variant family');
    if (this.isOp('=') || this.isOp('!=')) {
      const negate = this.isOp('!=');
      this.i++;
      return { kind: 'cmp', family, negate, values: [this.name('value')] };
    }
    if (this.isKeyword('IN')) {
      this.i++;
      this.expectOp('(');
      const values = [this.name('value')];
      while (this.isOp(',')) {
        this.i++;
        values.push(this.name('value'));
      }
      this.expectOp(')');
      return { kind: 'cmp', family, negate: false, values };
    }
    const t = this.peek();
    throw new ExprSyntaxError(`Expected '=', '!=' or IN after ${family.name}`, t.pos);
  }
}

function describe(t: Token): string {
  return t.type === 'end' ? 'end of expression' : t.text;
}

/** Parses an expression. Blank input gives `ast: null` (always true) and no errors. */
export function parse(src: string): { ast: Expr | null; errors: ExprError[] } {
  if (!src.trim()) return { ast: null, errors: [] };
  try {
    return { ast: new Parser(tokenize(src)).parse(), errors: [] };
  } catch (e) {
    if (e instanceof ExprSyntaxError) return { ast: null, errors: [{ message: e.message, pos: e.pos }] };
    throw e;
  }
}

/** Syntax errors plus references to unknown variant families or values. */
export function validate(src: string, families: OptionFamily[]): ExprError[] {
  const { ast, errors } = parse(src);
  if (!ast) return errors;
  return comparisons(ast).flatMap((e): ExprError[] => {
    const fam = families.find((f) => f.name === e.family.name);
    if (!fam) return [{ message: `Unknown variant family '${e.family.name}'`, pos: e.family.pos }];
    return e.values.filter((v) => !fam.values.includes(v.name)).map((v) => ({ message: `'${v.name}' is not a value of ${fam.name}`, pos: v.pos }));
  });
}

/** Family and value names the expression compares, in source order; none when it has a syntax error. */
export function exprNames(src: string): { family: string; values: string[] }[] {
  const { ast } = parse(src);
  return ast ? comparisons(ast).map((e) => ({ family: e.family.name, values: e.values.map((v) => v.name) })) : [];
}

/** The comparisons of an expression, in source order. */
function comparisons(e: Expr): Cmp[] {
  switch (e.kind) {
    case 'or':
    case 'and':
      return e.items.flatMap(comparisons);
    case 'not':
      return comparisons(e.expr);
    case 'cmp':
      return [e];
  }
}

/** Replaces the names `pick` returns with `to`, quoted as needed. An expression with a syntax error is returned unchanged. */
function replaceNames(src: string, pick: (e: Cmp) => Name[], to: string): string {
  const { ast } = parse(src);
  if (!ast) return src;
  const names = comparisons(ast).flatMap(pick).reverse(); // from the end, so earlier positions stay valid
  return names.reduce((s, n) => s.slice(0, n.pos) + quoteName(to) + s.slice(n.end), src);
}

export const renameFamilyInExpr = (src: string, from: string, to: string): string =>
  replaceNames(src, (e) => (e.family.name === from ? [e.family] : []), to);

export const renameValueInExpr = (src: string, family: string, from: string, to: string): string =>
  replaceNames(src, (e) => (e.family.name === family ? e.values.filter((v) => v.name === from) : []), to);

/** `null` (blank expression) is always true. An unset family matches no value, so `=` is false and `!=` is true. */
export function evaluate(ast: Expr | null, config: OptionConfig): boolean {
  if (!ast) return true;
  switch (ast.kind) {
    case 'or':
      return ast.items.some((e) => evaluate(e, config));
    case 'and':
      return ast.items.every((e) => evaluate(e, config));
    case 'not':
      return !evaluate(ast.expr, config);
    case 'cmp': {
      const selected = config[ast.family.name];
      const hit = selected !== undefined && ast.values.some((v) => v.name === selected);
      return ast.negate ? !hit : hit;
    }
  }
}

/** Suggestions to replace `from`..`to` with; each already ends with the space or nothing that should follow it. */
export interface Completion {
  from: number;
  to: number;
  items: string[];
}

/** Where the next token goes; `inValue` and `afterInValue` are inside an IN list. */
type Slot = 'operand' | 'cmpOp' | 'inOpen' | 'value' | 'inValue' | 'afterInValue' | 'afterOperand';

/** What can be typed at `cursor`, filtered by the word being typed there. Picking an item replaces the whole word. */
export function complete(src: string, cursor: number, families: OptionFamily[]): Completion {
  const tokens = tokenize(src.slice(0, cursor), true).slice(0, -1);
  const last = tokens.at(-1);
  const word = last?.type === 'ident' && last.end === cursor ? last : undefined;
  if (word) tokens.pop();
  // An unquoted word goes on after the cursor when editing in its middle.
  const to = word && !word.quoted ? cursor + (/^[\w.-]*/.exec(src.slice(cursor))?.[0].length ?? 0) : cursor;
  const from = word?.pos ?? cursor;
  const none = { from, to, items: [] };

  let slot: Slot = 'operand';
  let family: string | undefined;
  let listed: string[] = [];
  let depth = 0; // open grouping parentheses
  for (const t of tokens) {
    const kw = keyword(t);
    const op = t.type === 'op' ? t.text : undefined;
    const name = t.type === 'ident' && !kw ? t.text : undefined;
    // Anything else is a syntax error before the cursor.
    switch (slot) {
      case 'operand':
        if (op === '(') depth++;
        else if (name !== undefined) [slot, family] = ['cmpOp', name];
        else if (kw !== 'NOT') return none;
        break;
      case 'cmpOp':
        if (op === '=' || op === '!=') slot = 'value';
        else if (kw === 'IN') slot = 'inOpen';
        else return none;
        break;
      case 'inOpen':
        if (op !== '(') return none;
        [slot, listed] = ['inValue', []];
        break;
      case 'value':
        if (name === undefined) return none;
        slot = 'afterOperand';
        break;
      case 'inValue':
        if (name === undefined) return none;
        listed.push(name);
        slot = 'afterInValue';
        break;
      case 'afterInValue':
        if (op === ',') slot = 'inValue';
        else if (op === ')') slot = 'afterOperand';
        else return none;
        break;
      case 'afterOperand':
        if (kw === 'AND' || kw === 'OR') slot = 'operand';
        else if (op === ')' && depth > 0) depth--;
        else return none;
    }
  }

  const values = families.find((f) => f.name === family)?.values ?? [];
  const items: Record<Slot, string[]> = {
    operand: [...families.map((f) => `${quoteName(f.name)} `), 'NOT '],
    cmpOp: ['= ', '!= ', 'IN ('],
    inOpen: ['('],
    value: values.map((v) => `${quoteName(v)} `),
    inValue: values.filter((v) => !listed.includes(v)).map(quoteName),
    afterInValue: [', ', ') '],
    afterOperand: ['AND ', 'OR ', ...(depth > 0 ? [') '] : [])],
  };
  const unquote = (text: string) => text.trim().replace(/^"|"$/g, '');
  const typed = word ? unquote(src.slice(word.pos, cursor)) : '';
  const matches = items[slot].filter((i) => unquote(i).toUpperCase().startsWith(typed.toUpperCase()));
  // Nothing to offer when the word is already complete.
  if (matches.length === 1 && word && unquote(src.slice(from, to)) === unquote(matches[0])) return none;
  return { from, to, items: matches };
}
