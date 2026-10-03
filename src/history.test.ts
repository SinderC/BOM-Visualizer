import { describe, expect, it } from 'vitest';
import { createHistory } from './history';

function setup(limit?: number) {
  const doc = { value: 'a' };
  const history = createHistory(() => doc.value, (s) => (doc.value = s), limit);
  const set = (v: string) => {
    doc.value = v;
    history.record();
  };
  return { doc, history, set };
}

describe('history', () => {
  it('undoes and redoes recorded changes', () => {
    const { doc, history, set } = setup();
    set('b');
    set('c');
    history.undo();
    expect(doc.value).toBe('b');
    history.undo();
    expect(doc.value).toBe('a');
    expect(history.canUndo).toBe(false);
    history.redo();
    history.redo();
    expect(doc.value).toBe('c');
    expect(history.canRedo).toBe(false);
  });

  it('ignores records without a change', () => {
    const { history, set } = setup();
    set('a');
    expect(history.canUndo).toBe(false);
  });

  it('drops the redo steps after a new change', () => {
    const { doc, history, set } = setup();
    set('b');
    history.undo();
    set('x');
    expect(history.canRedo).toBe(false);
    history.undo();
    expect(doc.value).toBe('a');
  });

  it('keeps at most `limit` steps and forgets all on reset', () => {
    const { doc, history, set } = setup(2);
    ['b', 'c', 'd'].forEach(set);
    history.undo();
    history.undo();
    expect(doc.value).toBe('b');
    expect(history.canUndo).toBe(false);
    history.reset();
    expect(history.canRedo).toBe(false);
  });
});
