import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import * as io from '../js/io.js';
import { captureSnapshot } from '../js/persistence/snapshot.js';
import { beginDrag, finishDrag, previewNode } from '../js/tools/drag-edit.js';

const DXF = ['0', 'SECTION', '2', 'ENTITIES',
  '0', 'LINE', '10', '0', '20', '0', '11', '1000', '21', '0',
  '0', 'ENDSEC', '0', 'EOF'].join('\r\n');
const originalUnderlay = () => ({ name: 'original.dxf',
  entities: [{ type: 'circle', cx: 10, cy: 20, r: 30 }] });

function setup(t) {
  const previous = globalThis.FileReader;
  globalThis.FileReader = class {
    readAsText(file) {
      file.text().then(text => { this.result = text; this.onload?.(); },
        error => { this.error = error; this.onerror?.(); });
    }
  };
  t.after(() => {
    if (previous === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = previous;
  });
  const state = new AppState();
  state.setUnderlay(originalUnderlay());
  return { state, history: new History(state) };
}

test('DXF replacement is one undo entry and redo restores the imported drawing', async t => {
  const { state, history } = setup(t);
  const result = await io.importDXFUnderlay(new File([DXF], 'incoming.dxf'), state, history);
  const imported = structuredClone(state.underlay);
  assert.equal(result.count, 1);
  assert.equal(imported.name, 'incoming.dxf');
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.undo(), true);
  assert.deepEqual(state.underlay, originalUnderlay());
  assert.equal(history.redo(), true);
  assert.deepEqual(state.underlay, imported);
});

test('pending DXF import captures history at completion and preserves intervening edits', async t => {
  const { state, history } = setup(t);
  const file = new File([DXF], 'incoming.dxf');
  let completeRead;
  t.mock.method(file, 'text', () => new Promise(resolve => { completeRead = resolve; }));
  const pending = io.importDXFUnderlay(file, state, history);
  const node = history.transact(() => state.addNode(3000, 4000));
  completeRead(DXF);
  await pending;
  assert.equal(history.undoStack.length, 2);
  history.undo();
  assert.deepEqual(state.underlay, originalUnderlay());
  assert.equal(state.getNode(node.id).x, 3000);
  history.undo();
  assert.equal(state.nodes.length, 0);
});

test('invalid and unchanged DXF imports preserve model revision and redo', async t => {
  const { state, history } = setup(t);
  await io.importDXFUnderlay(new File([DXF], 'incoming.dxf'), state, history);
  history.transact(() => state.addNode(10, 20));
  history.undo();
  const before = captureSnapshot(state);
  const undo = structuredClone(history.undoStack);
  const redo = structuredClone(history.redoStack);
  await assert.rejects(io.importDXFUnderlay(new File(['0\r\nEOF'], 'empty.dxf'), state, history),
    /No drawable entities/);
  await io.importDXFUnderlay(new File([DXF], 'incoming.dxf'), state, history);
  assert.deepEqual(captureSnapshot(state), before);
  assert.deepEqual(history.undoStack, undo);
  assert.deepEqual(history.redoStack, redo);
});

test('clearing an underlay supports undo and redo; clearing an empty drawing is a no-op', t => {
  const { state, history } = setup(t);
  assert.equal(io.clearDXFUnderlay(state, history), true);
  assert.equal(state.underlay, null);
  assert.equal(history.undo(), true);
  assert.deepEqual(state.underlay, originalUnderlay());
  assert.equal(history.redo(), true);
  history.transact(() => state.addNode(10, 20));
  history.undo();
  const before = captureSnapshot(state);
  const undo = structuredClone(history.undoStack);
  const redo = structuredClone(history.redoStack);
  assert.equal(io.clearDXFUnderlay(state, history), false);
  assert.deepEqual(captureSnapshot(state), before);
  assert.deepEqual(history.undoStack, undo);
  assert.deepEqual(history.redoStack, redo);
});

test('DXF completion and clear cannot capture a provisional drag in history', async t => {
  const { state, history } = setup(t);
  const node = state.addNode(100, 0);
  history.transact(() => state.updateNode(node.id, { x: 200 }));
  history.undo();
  const committed = captureSnapshot(state);
  const undo = structuredClone(history.undoStack);
  const redo = structuredClone(history.redoStack);
  const file = new File([DXF], 'incoming.dxf');
  let completeRead;
  t.mock.method(file, 'text', () => new Promise(resolve => { completeRead = resolve; }));
  const pending = io.importDXFUnderlay(file, state, history);
  const manager = { state, history };
  beginDrag(manager);
  t.after(() => finishDrag(manager, false));
  previewNode(manager, node.id, { x: 500 });
  const preview = captureSnapshot(state);
  const rejected = assert.rejects(pending, /finish or cancel.*edit/i);
  completeRead(DXF);
  await rejected;
  assert.throws(() => io.clearDXFUnderlay(state, history), /finish or cancel.*edit/i);
  assert.deepEqual(captureSnapshot(state), preview);
  assert.deepEqual(history.undoStack, undo);
  assert.deepEqual(history.redoStack, redo);
  finishDrag(manager, false);
  assert.deepEqual(captureSnapshot(state), committed);
  assert.equal(history.redo(), true);
  assert.equal(state.getNode(node.id).x, 200);
});

test('DXF import remains usable without a history instance', async t => {
  const { state } = setup(t);
  await io.importDXFUnderlay(new File([DXF], 'incoming.dxf'), state);
  assert.equal(state.underlay.name, 'incoming.dxf');
  assert.equal(io.clearDXFUnderlay(state), true);
  assert.equal(state.underlay, null);
});
