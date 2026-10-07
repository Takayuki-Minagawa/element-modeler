// history.js - Undo/Redo with snapshot approach
import { captureSnapshot, restoreSnapshot } from './persistence/snapshot.js';

const MAX_HISTORY = 50;

export class History {
  constructor(state) {
    this.state = state;
    this.undoStack = [];
    this.redoStack = [];
    this.onRestore = null;
    // Operation context belongs to the undo entry, never to saved model data.
    this._contexts = new WeakMap();
  }

  setOnRestore(callback) {
    this.onRestore = typeof callback === 'function' ? callback : null;
  }

  save(context = null) {
    const snapshot = captureSnapshot(this.state);
    this._contexts.set(snapshot, context);
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  // Runs fn and records an undo entry only when fn returns truthy (= the
  // model actually changed). A no-op leaves undo AND redo untouched, unlike
  // save() + undo(), which would reset selection/tool state and clear redo.
  transact(fn, context = null) {
    if (fn.constructor?.name === 'AsyncFunction') {
      throw new Error('History.transact requires a synchronous callback');
    }
    const snap = captureSnapshot(this.state);
    let changed;
    try {
      changed = fn();
      if (changed && typeof changed.then === 'function') {
        throw new Error('History.transact requires a synchronous callback');
      }
    } catch (error) {
      restoreSnapshot(this.state, snap, { rollback: true });
      throw error;
    }
    if (changed) {
      this._contexts.set(snap, context);
      this.undoStack.push(snap);
      if (this.undoStack.length > MAX_HISTORY) {
        this.undoStack.shift();
      }
      this.redoStack = [];
    }
    return changed;
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const current = captureSnapshot(this.state);
    const target = this.undoStack.at(-1);
    const context = this._contexts.get(target) ?? null;
    restoreSnapshot(this.state, target);
    this.undoStack.pop();
    this._contexts.set(current, context);
    this.redoStack.push(current);
    this.onRestore?.(context);
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const current = captureSnapshot(this.state);
    const target = this.redoStack.at(-1);
    const context = this._contexts.get(target) ?? null;
    restoreSnapshot(this.state, target);
    this.redoStack.pop();
    this._contexts.set(current, context);
    this.undoStack.push(current);
    this.onRestore?.(context);
    return true;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
