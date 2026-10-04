import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { captureSnapshot } from '../js/persistence/snapshot.js';
import { initLayerModal } from '../js/layer-modal.js';
import { initAxesModal } from '../js/axes-modal.js';
import { initComboModal } from '../js/combo-modal.js';

// Event handlers run against real state/history; this fixture supplies only
// the native DOM operations used to build the management forms.
class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.dataset = {};
    this.value = '';
    const classes = new Set();
    this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) };
  }
  set value(value) { this._value = String(value); }
  get value() { return this._value; }
  set innerHTML(value) { this.html = value; this.children = []; }
  addEventListener(type, callback) { (this.listeners[type] ||= []).push(callback); }
  emit(type) { for (const callback of this.listeners[type] || []) callback({ target: this }); }
  click() { this.emit('click'); }
  appendChild(child) { this.children.push(child); }
  querySelectorAll() { return []; }
  setAttribute() {}
  setCustomValidity() {}
  focus() {}
  remove() {}
}

const kinds = {
  layer: { init: initLayerModal, list: 'layer-list', add: 'btn-layer-add', name: 1, number: 2, addMethod: 'addLevel' },
  axis: { init: initAxesModal, list: 'axes-list', add: 'btn-axes-add-x', name: 1, number: 2, addMethod: 'addAxis' },
  combo: { init: initComboModal, list: 'combo-list', add: 'btn-combo-add', name: 0, number: 1, addMethod: 'addLoadCombination' },
};

function fixture(t, kind, state = new AppState()) {
  const originals = { document: globalThis.document, window: globalThis.window };
  t.after(() => Object.assign(globalThis, originals));
  const ids = [...readFileSync(new URL('../index.html', import.meta.url), 'utf8').matchAll(/id="([^"]+)"/g)].map(match => match[1]);
  const elements = new Map(ids.map(id => [id, new Element()]));
  elements.set('app-notice-host', new Element());
  globalThis.document = { getElementById: id => elements.get(id), createElement: () => new Element() };
  globalThis.window = { setTimeout: () => 1, clearTimeout() {} };
  if (kind === 'axis') state.addAxis('x', 'X1', 1000);
  const history = new History(state);
  const notifications = [];
  const api = kinds[kind].init({
    state, history,
    onModelChange: () => notifications.push(history.undoStack.length),
    refreshLevelSelectors() {},
  });
  const el = id => elements.get(id);
  const open = () => kind === 'layer' ? el('btn-layer-manage').click() : api.show();
  open();
  const row = (index = 0) => el(kinds[kind].list).children[index + 1];
  const edit = (field, value) => {
    const input = row().children[kinds[kind][field]];
    input.value = value;
    input.emit('change');
    return input;
  };
  return { state, history, notifications, el, open, row, edit };
}

function assertUndoRedo({ state, history, notifications }, before) {
  const after = state.toJSON();
  assert.notDeepEqual(after, before);
  assert.equal(notifications.at(-1), history.undoStack.length, 'notify only after history commits');
  assert.equal(history.undo(), true);
  assert.deepEqual(state.toJSON(), before);
  assert.equal(history.redo(), true);
  assert.deepEqual(state.toJSON(), after);
}

for (const kind of Object.keys(kinds)) {
  test(`${kind} add, rename, numeric edit and deletion each create one undoable command`, t => {
    const f = fixture(t, kind);
    const actions = [
      () => f.el(kinds[kind].add).click(),
      () => f.edit('name', 'Updated'),
      () => f.edit('number', 1200),
      () => f.row().children.at(-1).click(),
    ];
    for (const action of actions) {
      f.open();
      const before = f.state.toJSON();
      const entries = f.history.undoStack.length;
      const notifications = f.notifications.length;
      action();
      assert.equal(f.history.undoStack.length, entries + 1);
      assert.equal(f.notifications.length, notifications + 1);
      assertUndoRedo(f, before);
    }
  });

  test(`${kind} no-op and invalid number edits preserve redo, revision and notifications`, t => {
    const f = fixture(t, kind);
    f.history.save(); f.state.addNode(10, 20); f.history.undo();
    f.open();
    const before = captureSnapshot(f.state);
    const row = f.row();
    f.edit('name', row.children[kinds[kind].name].value);
    f.edit('number', row.children[kinds[kind].number].value);
    for (const value of ['', ' ', 'Infinity', '12invalid']) {
      const input = f.edit('number', value);
      assert.notEqual(input.value, value);
    }
    if (kind !== 'layer') {
      const input = f.edit('name', '   ');
      assert.notEqual(input.value, '   ');
    }
    assert.deepEqual(captureSnapshot(f.state), before);
    assert.equal(f.history.undoStack.length, 0);
    assert.equal(f.history.redoStack.length, 1);
    assert.equal(f.notifications.length, 0);
  });

  test(`${kind} failed mutation rolls back model, counters and history`, t => {
    const method = kinds[kind].addMethod;
    let fail = false;
    class FailingState extends AppState {
      [method](...args) {
        const result = super[method](...args);
        if (fail) throw new Error('write failed');
        return result;
      }
    }
    const f = fixture(t, kind, new FailingState());
    f.history.save(); f.state.addNode(10, 20); f.history.undo();
    const before = captureSnapshot(f.state);
    fail = true;
    assert.throws(() => f.el(kinds[kind].add).click(), /write failed/);
    assert.deepEqual(captureSnapshot(f.state), before);
    assert.equal(f.history.undoStack.length, 0);
    assert.equal(f.history.redoStack.length, 1);
    assert.equal(f.notifications.length, 0);
  });
}

test('axis direction changes are undoable and unchanged direction preserves redo', t => {
  const f = fixture(t, 'axis');
  const before = f.state.toJSON();
  const input = f.row().children[0];
  input.value = 'y'; input.emit('change');
  assert.equal(f.state.axes[0].dir, 'y');
  assertUndoRedo(f, before);
  f.history.undo(); f.open();
  const revision = f.state.revision;
  f.row().children[0].emit('change');
  assert.equal(f.state.revision, revision);
  assert.equal(f.history.redoStack.length, 1);
});

test('layer duplicate heights, in-use deletion and last-layer deletion keep history intact', t => {
  const f = fixture(t, 'layer');
  f.state.addSupport(0, 0, { levelId: f.state.levels[0].id });
  f.history.save(); f.state.addNode(10, 20); f.history.undo();
  f.open();
  const before = captureSnapshot(f.state);
  f.edit('number', f.state.levels[1].z);
  f.row().children.at(-1).click();
  assert.deepEqual(captureSnapshot(f.state), before);
  assert.equal(f.history.redoStack.length, 1);
  assert.equal(f.history.undoStack.length, 0);
  assert.equal(f.notifications.length, 0);

  f.state.supports = [];
  f.state.levels = [f.state.levels[0]];
  f.open();
  const last = captureSnapshot(f.state);
  f.row().children.at(-1).click();
  assert.deepEqual(captureSnapshot(f.state), last);
  assert.equal(f.history.redoStack.length, 1);
  assert.equal(f.notifications.length, 0);
});
