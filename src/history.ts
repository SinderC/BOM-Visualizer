/**
 * Snapshot-based undo/redo. Call `record` after every change: it compares a snapshot of the whole document with the
 * previous one, so any mutation is undoable without per-command code, and view-only changes add no steps.
 */
export function createHistory(save: () => string, restore: (snapshot: string) => void, limit = 100) {
  let current = save();
  let undoStack: string[] = [];
  let redoStack: string[] = [];

  const step = (from: string[], to: string[]) => {
    const snapshot = from.pop();
    if (snapshot === undefined) return;
    to.push(current);
    restore(snapshot);
    current = save(); // not `snapshot`, in case restore+save does not round-trip byte for byte
  };

  return {
    record(): void {
      const now = save();
      if (now === current) return;
      undoStack.push(current);
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
      current = now;
    },
    undo: () => step(undoStack, redoStack),
    redo: () => step(redoStack, undoStack),
    /** Forgets all steps, e.g. after opening another document. */
    reset(): void {
      undoStack = [];
      redoStack = [];
      current = save();
    },
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
  };
}

export type History = ReturnType<typeof createHistory>;
