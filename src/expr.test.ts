import { describe, expect, it } from 'vitest';
import { evaluate, parse, validate } from './expr';

const families = [
  { name: 'ENGINE', values: ['V6', 'V8', 'EV'] },
  { name: 'MARKET', values: ['EU', 'US'] },
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
});
