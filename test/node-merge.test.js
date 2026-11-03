import test from 'node:test';
import assert from 'node:assert/strict';
import { planNearbyNodeMerge } from '../js/domain/node-merge.js';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { executeModelCommand } from '../js/commands/model-command.js';

// Independent reference: the previous all-pairs implementation defines the
// greedy contract, including its behavior for imported or directly edited data.
function referenceRemap(input, tolerance) {
  const nodes = [...input].sort((a, b) => a.id - b.id);
  const remap = new Map();
  for (let i = 0; i < nodes.length; i++) {
    if (remap.has(nodes[i].id)) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      if (remap.has(nodes[j].id)) continue;
      if (Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y) <= tolerance) {
        remap.set(nodes[j].id, nodes[i].id);
      }
    }
  }
  return remap;
}

test('node merge crosses positive and negative cell boundaries and includes the exact radius', () => {
  const nodes = [
    { id: 10, x: -2.5, y: -2 }, { id: 11, x: -1.5, y: -2 },
    { id: 20, x: 1.5, y: 2 }, { id: 21, x: 2.5, y: 2 },
    { id: 30, x: 10, y: 10 }, { id: 31, x: 10.5, y: 10.5 },
    { id: 32, x: 11.00001, y: 10 },
  ];
  assert.deepEqual(planNearbyNodeMerge(nodes, 1), new Map([[11, 10], [21, 20], [31, 30]]));
});

test('node merge preserves greedy survivors and chooses the first ID rather than the nearest node', () => {
  const nodes = [
    { id: 3, x: 1.1, y: 0 }, { id: 1, x: 0, y: 0 },
    { id: 4, x: 0.9, y: 0 }, { id: 2, x: 0.8, y: 0 },
  ];
  const before = structuredClone(nodes);
  assert.deepEqual(planNearbyNodeMerge(nodes, 1), new Map([[2, 1], [4, 1]]));
  assert.deepEqual(nodes, before, 'planning must not sort or mutate the input');
});

test('node merge matches the old all-pairs algorithm across seeded clouds and tolerances', () => {
  let seed = 0x12345678;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (const tolerance of [0.01, 0.3, 1, 50, 1000]) {
    for (let run = 0; run < 25; run++) {
      const nodes = Array.from({ length: 100 }, (_, index) => ({
        id: 100 - index,
        x: (Math.floor(random() * 20) - 10 + random() * 0.9) * tolerance,
        y: (Math.floor(random() * 20) - 10 + random() * 0.9) * tolerance,
      }));
      assert.deepEqual(planNearbyNodeMerge(nodes, tolerance), referenceRemap(nodes, tolerance));
    }
  }
});

test('unsafe grid coordinates and exceptional records preserve the scan behavior', () => {
  const cases = [
    { tolerance: 1, nodes: [{ id: 1, x: 1e18, y: 0 }, { id: 2, x: 1e18, y: 0 }] },
    { tolerance: 1e-300, nodes: [{ id: 1, x: 1e100, y: 0 }, { id: 2, x: 1e100, y: 0 }] },
    { tolerance: Number.MAX_VALUE, nodes: [{ id: 1, x: 0, y: 0 }, { id: 2, x: 100, y: 200 }] },
    { tolerance: 1, nodes: [{ id: 1, x: '0', y: null }, { id: 2, x: 0.5, y: 0 }] },
    { tolerance: 1, nodes: [{ id: 1, x: NaN, y: 0 }, { id: 2, x: Infinity, y: 0 },
      { id: 3, x: 0, y: 0 }, { id: 4, x: 0.5, y: 0 }] },
    { tolerance: 1, nodes: [{ id: 1, x: 0, y: 0 }, { id: 1, x: 100, y: 0 },
      { id: 2, x: 100.5, y: 0 }, { id: 3, x: 0.5, y: 0 }] },
  ];
  for (const { nodes, tolerance } of cases) {
    assert.deepEqual(planNearbyNodeMerge(nodes, tolerance), referenceRemap(nodes, tolerance));
  }
});

test('merge commits one undo step, restores endpoints on undo, and leaves redo intact on a no-op', () => {
  const state = new AppState();
  const history = new History(state);
  const a = state.addNode(0, 0);
  const b = state.addNode(1000, 0);
  const nearB = state.addNode(1000.5, 0);
  const d = state.addNode(2000, 0);
  state.addMember(a.id, b.id);
  state.addMember(nearB.id, d.id);
  const before = state.toJSON();
  const revision = state.revision;
  const result = executeModelCommand(history, state, () => state.mergeNearbyNodes());
  assert.deepEqual(result, { changed: true, result: { mergedNodes: 1 } });
  assert.equal(state.revision, revision + 1);
  assert.equal(history.undoStack.length, 1);
  assert.equal(state.members[1].startNodeId, b.id);
  const after = state.toJSON();
  assert.equal(history.undo(), true);
  assert.deepEqual(state.toJSON(), before);
  const restoredRevision = state.revision;
  assert.deepEqual(executeModelCommand(history, state, () => state.mergeNearbyNodes({ tolerance: 0.1 })),
    { changed: false, result: { mergedNodes: 0 } });
  assert.equal(state.revision, restoredRevision);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);
  assert.equal(history.redo(), true);
  assert.deepEqual(state.toJSON(), after);
});
