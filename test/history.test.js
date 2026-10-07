import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../js/state.js';
import { History } from '../js/history.js';

const MAX_HISTORY = 50; // history.js internal cap (not exported)

test('undo restores the snapshot taken by save and redo reapplies the change', () => {
  const state = new AppState();
  const history = new History(state);

  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(5000, 0);
  const before = state.snapshot();

  history.save();
  state.addMember(n1.id, n2.id, { type: 'beam' });
  const after = state.snapshot();
  assert.equal(state.members.length, 1);

  assert.equal(history.undo(), true);
  assert.equal(state.members.length, 0);
  assert.equal(state.nodes.length, 2);
  assert.deepEqual(state.snapshot(), before);

  assert.equal(history.redo(), true);
  assert.equal(state.members.length, 1);
  assert.deepEqual(state.snapshot(), after);
});

test('undo and redo return false when their stacks are empty', () => {
  const state = new AppState();
  const history = new History(state);

  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);

  history.save();
  state.addNode(1000, 1000);
  assert.equal(history.undo(), true);
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), true);
  assert.equal(history.redo(), false);
});

test('restore callback runs after successful undo and redo only', () => {
  const state = new AppState();
  const history = new History(state);
  const restoredMemberCounts = [];
  history.setOnRestore(() => restoredMemberCounts.push(state.members.length));

  assert.equal(history.undo(), false);
  assert.deepEqual(restoredMemberCounts, []);

  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(5000, 0);
  history.save();
  state.addMember(n1.id, n2.id, { type: 'beam' });

  assert.equal(history.undo(), true);
  assert.equal(history.redo(), true);
  assert.deepEqual(restoredMemberCounts, [0, 1]);

  history.setOnRestore(null);
  assert.equal(history.undo(), true);
  assert.deepEqual(restoredMemberCounts, [0, 1]);
});

test('save clears the redo stack', () => {
  const state = new AppState();
  const history = new History(state);

  history.save();
  state.addNode(0, 0);
  assert.equal(history.undo(), true);
  assert.equal(history.redoStack.length, 1);

  history.save();
  state.addNode(2000, 2000);
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.redo(), false);
});

test('restore context follows its operation across undo/redo and is absent from model snapshots', () => {
  const state = new AppState();
  const history = new History(state);
  const contexts = [];
  history.setOnRestore(context => contexts.push(context));
  history.save('model-replacement');
  state.addNode(1000, 0);
  history.transact(() => state.addNode(2000, 0));
  history.transact(() => false, 'unused');
  history.undo(); history.undo(); history.redo(); history.redo();
  assert.deepEqual(contexts, [null, 'model-replacement', 'model-replacement', null]);
  assert.equal(JSON.stringify(state.toJSON()).includes('model-replacement'), false);
  assert.equal(JSON.stringify(history.undoStack).includes('model-replacement'), false);
  contexts.length = 0;
  history.transact(() => state.addNode(3000, 0), 'model-replacement');
  history.undo(); history.redo(); history.undo();
  assert.deepEqual(contexts, ['model-replacement', 'model-replacement', 'model-replacement']);
});

test('undo history is capped at MAX_HISTORY snapshots (oldest dropped)', () => {
  const state = new AppState();
  const history = new History(state);

  const total = MAX_HISTORY + 10;
  for (let i = 0; i < total; i++) {
    history.save();
    state.addNode(i * 100, 0);
  }
  assert.equal(state.nodes.length, total);
  assert.equal(history.undoStack.length, MAX_HISTORY);

  let undoCount = 0;
  while (history.undo()) undoCount++;
  assert.equal(undoCount, MAX_HISTORY);

  // The 10 oldest states fell off the stack, so 10 nodes remain.
  assert.equal(state.nodes.length, total - MAX_HISTORY);
});

test('undo/redo restores full serialized state including members and surfaces', () => {
  const state = new AppState();
  const history = new History(state);

  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(4000, 0);
  state.addMember(n1.id, n2.id, { type: 'beam' });
  const baseline = state.toJSON();

  history.save();
  state.addSurfacePolygon(
    [{ x: 0, y: 0 }, { x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    { type: 'floor' }
  );
  assert.equal(state.surfaces.length, 1);

  assert.equal(history.undo(), true);
  assert.deepEqual(state.toJSON(), baseline);

  assert.equal(history.redo(), true);
  assert.equal(state.surfaces.length, 1);
});

test('clear empties both stacks', () => {
  const state = new AppState();
  const history = new History(state);

  history.save();
  state.addNode(0, 0);
  assert.equal(history.undo(), true);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);

  history.save();
  history.clear();
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.undo(), false);
  assert.equal(history.redo(), false);
});

test('transact records an undo entry only when the callback reports a change', () => {
  const state = new AppState();
  const history = new History(state);

  // Establish a redo entry to verify no-ops leave it intact.
  history.save();
  state.addNode(0, 0);
  history.undo();
  assert.equal(history.redoStack.length, 1);

  // No-op: nothing recorded, redo preserved.
  assert.equal(history.transact(() => false), false);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);

  // Real change: undo entry recorded, redo cleared, undo restores.
  const changed = history.transact(() => {
    state.addNode(1000, 0);
    return true;
  });
  assert.equal(changed, true);
  assert.equal(state.nodes.length, 1);
  assert.equal(history.redoStack.length, 0);
  assert.equal(history.undo(), true);
  assert.equal(state.nodes.length, 0);
});

test('history restores unused catalogs, nested definitions, counters and runtime exactly', () => {
  const state = new AppState();
  const history = new History(state);
  state.addSection({ target: 'member', type: 'beam', name: 'unused', b: 111, h: 222 });
  state.addSpring({ symbol: 'UNUSED' });
  state.addMaterial({ name: 'custom', E: 100, G: 40, density: 400 });
  const node = state.addNode(1, 2);
  state.select('node', node.id);
  state.memberDraftSections.beam = 'unused';
  state._nodeCounter = 200;
  const before = structuredClone({ ...state });
  history.save();
  state.sectionCatalog.find(s => s.name === 'unused').b = 555;
  state.springCatalog = [];
  state.materialCatalog = [];
  state.memberDraftSections.beam = 'changed';
  state.clearSelection();
  state.addNode(9, 9);
  const after = structuredClone({ ...state });
  const revision = state.revision;
  history.undo();
  assert.ok(state.revision > revision);
  assert.deepEqual({ ...state, revision: before.revision }, before);
  history.redo();
  assert.deepEqual({ ...state, revision: after.revision }, after);
  history.undo();
  assert.equal(state.addNode(5, 5).id, 201);
});

test('transaction exceptions roll back partial mutations and preserve redo', () => {
  const state = new AppState();
  const history = new History(state);
  history.save();
  state.addNode(0, 0);
  history.undo();
  const before = structuredClone({ ...state });
  const redo = structuredClone(history.redoStack);
  assert.throws(() => history.transact(() => {
    state.addNode(100, 100);
    state.sectionCatalog[0].b = 900;
    state.memberDraftSections.beam = 'broken';
    throw new Error('failed operation');
  }), /failed operation/);
  assert.deepEqual({ ...state }, before);
  assert.deepEqual(history.redoStack, redo);
  assert.equal(history.undoStack.length, 0);
});

test('failed snapshot restore leaves model and both stacks intact', () => {
  const state = new AppState();
  const history = new History(state);
  history.save();
  state.addNode(0, 0);
  history.undoStack[0].version = 999;
  const before = structuredClone({ ...state });
  const undo = structuredClone(history.undoStack);
  assert.throws(() => history.undo(), /Invalid history snapshot/);
  assert.deepEqual({ ...state }, before);
  assert.deepEqual(history.undoStack, undo);
  assert.equal(history.redoStack.length, 0);
});

test('history discards derived indexes and initializes them for the restored model', () => {
  class IndexedState extends AppState {
    invalidateDerivedCaches() { this._nodeIndex = null; this._nodeIndexRevision = -1; }
    lookup(id) {
      if (!this._nodeIndex) this._nodeIndex = new Map(this.nodes.map(n => [n.id, n]));
      return this._nodeIndex.get(id);
    }
  }
  const state = new IndexedState();
  const node = state.addNode(0, 0);
  state.lookup(node.id);
  const history = new History(state);
  history.save();
  assert.equal('_nodeIndex' in history.undoStack[0].data, false);
  state.nodes[0].x = 42;
  history.undo();
  assert.equal(state._nodeIndex, null);
  assert.equal(state._nodeIndexRevision, -1);
  assert.equal(state.lookup(node.id), state.nodes[0]);
  assert.equal(state.lookup(node.id).x, 0);
});

test('incomplete snapshot data cannot replace live state', () => {
  const state = new AppState();
  const history = new History(state);
  history.save();
  history.undoStack[0].data = {};
  const before = structuredClone({ ...state });
  assert.throws(() => history.undo(), /Invalid history snapshot data/);
  assert.deepEqual({ ...state }, before);
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.redoStack.length, 0);
});

test('async transactions are rejected before their callbacks run', () => {
  const state = new AppState();
  const history = new History(state);
  assert.throws(() => history.transact(async () => { state.addNode(0, 0); }), /synchronous/);
  assert.equal(state.nodes.length, 0);
  assert.equal(history.undoStack.length, 0);
});
