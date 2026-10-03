import type { OptionFamily } from './model';

/**
 * Variant expression language.
 *
 *   or      := and ('OR' and)*
 *   and     := not ('AND' not)*
 *   not     := 'NOT' not | primary
 *   primary := '(' or ')' | FAMILY ('=' | '!=') VALUE | FAMILY 'IN' '(' VALUE (',' VALUE)* ')'
 *
 * Keywords are case-insensitive; family and value names are case-sensitive.
 */

export interface Name {
  name: string;
  pos: number;
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

type Token =
  | { type: 'ident'; text: string; pos: number }
  | { type: 'op'; text: '(' | ')' | ',' | '=' | '!='; pos: number }
  | { type: 'end'; pos: number };

const KEYWORDS = ['AND', 'OR', 'NOT', 'IN'];

class ExprSyntaxError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (ch === '!' && src[i + 1] === '=') {
      tokens.push({ type: 'op', text: '!=', pos: i });
      i += 2;
    } else if ('(),='.includes(ch)) {
      tokens.push({ type: 'op', text: ch as '(' | ')' | ',' | '=', pos: i });
      i++;
    } else if (/[\w.-]/.test(ch)) {
      const start = i;
      while (i < src.length && /[\w.-]/.test(src[i])) i++;
      tokens.push({ type: 'ident', text: src.slice(start, i), pos: start });
    } else {
      throw new ExprSyntaxError(`Unexpected character '${ch}'`, i);
    }
  }
  tokens.push({ type: 'end', pos: src.length });
  return tokens;
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
    const t = this.peek();
    return t.type === 'ident' && t.text.toUpperCase() === kw;
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
    if (t.type !== 'ident' || KEYWORDS.includes(t.text.toUpperCase())) {
      throw new ExprSyntaxError(`Expected ${what} but found '${describe(t)}'`, t.pos);
    }
    this.i++;
    return { name: t.text, pos: t.pos };
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
    const family = this.name('option family');
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

/** Syntax errors plus references to unknown option families or values. */
export function validate(src: string, families: OptionFamily[]): ExprError[] {
  const { ast, errors } = parse(src);
  if (!ast) return errors;
  const out: ExprError[] = [];
  const walk = (e: Expr): void => {
    switch (e.kind) {
      case 'or':
      case 'and':
        e.items.forEach(walk);
        break;
      case 'not':
        walk(e.expr);
        break;
      case 'cmp': {
        const fam = families.find((f) => f.name === e.family.name);
        if (!fam) {
          out.push({ message: `Unknown option family '${e.family.name}'`, pos: e.family.pos });
          break;
        }
        for (const v of e.values) {
          if (!fam.values.includes(v.name)) {
            out.push({ message: `'${v.name}' is not a value of ${fam.name}`, pos: v.pos });
          }
        }
      }
    }
  };
  walk(ast);
  return out;
}

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
