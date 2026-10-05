import { describe, expect, it } from 'vitest';
import { complete, evaluate, parse, quoteName, renameFamilyInExpr, renameValueInExpr, validate } from './expr';

const families = [
  { name: 'ENGINE', values: ['V6', 'V8', 'EV'] },
  { name: 'MARKET', values: ['EU', 'US'] },
  { name: 'Engine type', values: ['V6 Turbo', 'IN'] },
];
const run = (src: string, config: Record<string, string>) => evaluate(parse(src).ast, config);

describe('expr', () => {
  it('treats blank as always true', () => {
    expect(parse('  ')).toEqual({ ast: null, errors: [] });
    expect(run('', {})).toBe(true);
  });

  it('evaluates =, != and IN', () => {
    expect(run('ENGINE=V8', { ENGINE: 'V8' })).toBe(true);
    expect(run('ENGINE=V8', { ENGINE: 'V6' })).toBe(false);
    expect(run('ENGINE != V8', { ENGINE: 'V6' })).toBe(true);
    expect(run('ENGINE IN (V6, EV)', { ENGINE: 'EV' })).toBe(true);
    expect(run('ENGINE IN (V6, EV)', { ENGINE: 'V8' })).toBe(false);
  });

  it('gives AND precedence over OR and supports NOT and parentheses', () => {
    const cfg = { ENGINE: 'V6', MARKET: 'US' };
    expect(run('ENGINE=V8 AND MARKET=EU OR MARKET=US', cfg)).toBe(true);
    expect(run('ENGINE=V8 AND (MARKET=EU OR MARKET=US)', cfg)).toBe(false);
    expect(run('NOT ENGINE=V8 and market=x or MARKET=US', cfg)).toBe(true);
    expect(run('not not ENGINE=V6', cfg)).toBe(true);
  });

  it('treats an unset family as matching no value', () => {
    expect(run('ENGINE=V8', {})).toBe(false);
    expect(run('ENGINE!=V8', {})).toBe(true);
  });

  it('reports syntax errors with position', () => {
    expect(parse('ENGINE=').errors).toEqual([{ message: "Expected value but found 'end of expression'", pos: 7 }]);
    expect(parse('ENGINE=V8 AND').errors[0].pos).toBe(13);
    expect(parse('(ENGINE=V8').errors[0].message).toMatch(/Expected '\)'/);
    expect(parse('ENGINE V8').errors[0].pos).toBe(7);
    expect(parse('ENGINE=V8 & X').errors[0]).toEqual({ message: "Unexpected character '&'", pos: 10 });
  });

  it('validates unknown families and values', () => {
    expect(validate('ENGINE=V8 AND MARKET IN (EU, JP)', families)).toEqual([
      { message: "'JP' is not a value of MARKET", pos: 29 },
    ]);
    expect(validate('COLOR=RED', families)).toEqual([{ message: "Unknown variant family 'COLOR'", pos: 0 }]);
    expect(validate('ENGINE=V8', families)).toEqual([]);
  });

  it('reads double-quoted names, which may contain spaces or be keywords', () => {
    expect(run('"Engine type" = "V6 Turbo"', { 'Engine type': 'V6 Turbo' })).toBe(true);
    expect(run('"Engine type" IN ("IN", X)', { 'Engine type': 'IN' })).toBe(true);
    expect(run('"ENGINE"=V8', { ENGINE: 'V8' })).toBe(true);
    expect(validate('"Engine type"="V6 Turbo" AND "Engine type" != "IN"', families)).toEqual([]);
    expect(validate('"Engine type"=V6', families)).toEqual([{ message: "'V6' is not a value of Engine type", pos: 14 }]);
    expect(parse('ENGINE="V8').errors).toEqual([{ message: `Missing closing '"'`, pos: 7 }]);
  });

  it('quotes names only when needed', () => {
    expect(['V8', 'a.b-c_1', 'V6 Turbo', 'in', 'A/B'].map(quoteName)).toEqual(['V8', 'a.b-c_1', '"V6 Turbo"', '"in"', '"A/B"']);
  });

  it('renames families and values in expressions', () => {
    expect(renameFamilyInExpr('ENGINE=V8 OR (NOT ENGINE IN (V6))', 'ENGINE', 'Engine type')).toBe('"Engine type"=V8 OR (NOT "Engine type" IN (V6))');
    expect(renameFamilyInExpr('"Engine type"=V8', 'Engine type', 'ENGINE')).toBe('ENGINE=V8');
    expect(renameValueInExpr('ENGINE IN (V6, V8) AND MARKET=V6', 'ENGINE', 'V6', 'V6 Turbo')).toBe('ENGINE IN ("V6 Turbo", V8) AND MARKET=V6');
    expect(renameFamilyInExpr('ENGINE=', 'ENGINE', 'X')).toBe('ENGINE='); // syntax error: left as is
  });

  describe('complete', () => {
    const at = (src: string, cursor = src.length) => complete(src, cursor, families);
    const items = (src: string) => at(src).items;

    it('suggests families and NOT where an operand goes, filtered case-insensitively by the word typed', () => {
      expect(items('')).toEqual(['ENGINE ', 'MARKET ', '"Engine type" ', 'NOT ']);
      expect(items('e')).toEqual(['ENGINE ', '"Engine type" ']);
      expect(items('"Engine t')).toEqual(['"Engine type" ']);
      expect(items('ENGINE=V6 AND (')).toEqual(items(''));
      expect(at('ENGINE=V6 OR ma')).toEqual({ from: 13, to: 15, items: ['MARKET '] });
    });

    it('suggests operators after a family and its values after = or !=', () => {
      expect(items('ENGINE ')).toEqual(['= ', '!= ', 'IN (']);
      expect(items('ENGINE i')).toEqual(['IN (']);
      expect(items('ENGINE IN ')).toEqual(['(']);
      expect(items('ENGINE = ')).toEqual(['V6 ', 'V8 ', 'EV ']);
      expect(items('"Engine type"!=')).toEqual(['"V6 Turbo" ', '"IN" ']);
      expect(items('COLOR = ')).toEqual([]);
    });

    it('suggests the values not yet listed, then , and ), inside IN', () => {
      expect(items('ENGINE IN (V6, ')).toEqual(['V8', 'EV']);
      expect(items('ENGINE IN (V6 ')).toEqual([', ', ') ']);
    });

    it('suggests AND and OR after an operand, and ) while a group is open', () => {
      expect(items('ENGINE = V6 ')).toEqual(['AND ', 'OR ']);
      expect(items('(ENGINE = V6 ')).toEqual(['AND ', 'OR ', ') ']);
      expect(items('ENGINE IN (V6) ')).toEqual(['AND ', 'OR ']);
      expect(items('ENGINE=V6 a')).toEqual(['AND ']);
    });

    it('replaces the whole word under the cursor and hides a word that is already complete', () => {
      expect(complete('MA AND X', 1, families)).toEqual({ from: 0, to: 2, items: ['MARKET '] });
      expect(items('MARKET')).toEqual([]);
      expect(items('ENGINE = V6')).toEqual([]);
      expect(items('market')).toEqual(['MARKET ']);
      expect(items('ENGINE')).toEqual(['ENGINE ', '"Engine type" ']); // also the start of another name
    });

    it('offers nothing after a syntax error', () => {
      expect(items('ENGINE V6 ')).toEqual([]);
      expect(items('ENGINE = V6)')).toEqual([]);
    });
  });
});
