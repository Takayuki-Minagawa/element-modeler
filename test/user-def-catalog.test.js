import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { createCatalogCommands } from '../js/ui/user-def/catalog-commands.js';
import { renderCatalogTable } from '../js/ui/user-def/table.js';
import { captureSnapshot } from '../js/persistence/snapshot.js';
import { beginDrag, finishDrag, previewNode } from '../js/tools/drag-edit.js';

class FileReaderShim {
  readAsText(file) {
    file.text().then(text => { this.result = text; this.onload(); }, error => {
      this.error = error;
      this.onerror();
    });
  }
}
globalThis.FileReader = FileReaderShim;
const file = data => new Blob([JSON.stringify(data)]);
const content = state => {
  const { revision: _revision, ...data } = structuredClone({ ...state });
  return data;
};
function setup(State = AppState) {
  const state = new State();
  const history = new History(state);
  let transactions = 0;
  const commands = createCatalogCommands({ state, history: {
    transact(fn) { transactions++; return history.transact(fn); },
  } });
  return { state, history, commands, transactions: () => transactions };
}
function preserveRedo({ state, history }) {
  history.save();
  state.addNode(123, 456);
  history.undo();
}
function assertUnchanged(env, action) {
  const before = structuredClone({ ...env.state });
  const stacks = structuredClone([env.history.undoStack, env.history.redoStack]);
  const count = env.transactions();
  const sections = env.state.sectionCatalog;
  const check = () => {
    assert.deepEqual({ ...env.state }, before);
    assert.equal(env.state.sectionCatalog, sections);
    assert.deepEqual([env.history.undoStack, env.history.redoStack], stacks);
    assert.equal(env.transactions(), count, 'validation/no-op must not enter history');
  };
  const result = action();
  if (result?.then) return result.then(check);
  check();
}

for (const spec of [
  { kind: 'Section', entry: { target: 'member', type: 'beam', name: 'Custom', b: 200, h: 400 }, key: ['member', 'beam', 'Custom'], patch: { b: 250 } },
  { kind: 'Section', entry: { target: 'surface', type: 'roof', name: 'Custom' }, key: ['surface', 'roof', 'Custom'], patch: { memo: 'Updated roof' } },
  { kind: 'Spring', entry: { symbol: 'Custom', kr: 200 }, key: ['Custom'], patch: { kr: 300 } },
  { kind: 'Material', entry: { name: 'Custom', E: 200, G: 80, density: 7000 }, key: ['Custom'], patch: { E: 250 } },
]) {
  test(`${spec.kind} ${spec.entry.target || ''}: add, update, remove each have exactly one reversible entry`, () => {
    const { state, history, commands } = setup();
    for (const [method, args] of [
      [`add${spec.kind}`, [spec.entry]],
      [`update${spec.kind}`, [...spec.key, spec.patch]],
      [`remove${spec.kind}`, spec.key],
    ]) {
      const before = content(state);
      const count = history.undoStack.length;
      assert.ok(commands[method](...args));
      const after = content(state);
      assert.notDeepEqual(after, before);
      assert.equal(history.undoStack.length, count + 1);
      assert.equal(history.undo(), true);
      assert.deepEqual(content(state), before);
      assert.equal(history.redo(), true);
      assert.deepEqual(content(state), after);
    }
  });
}

test('normalized no-op updates, duplicates, invalid input and missing records preserve revision and both stacks', () => {
  const env = setup();
  const { state, commands } = env;
  state.addSection({ target: 'member', type: 'beam', name: 'B', b: 200, h: 400 });
  state.addSpring({ symbol: 'S', kr: 100, memo: 'Memo' });
  state.addMaterial({ name: 'M', E: 200, G: 80, density: 7000 });
  preserveRedo(env);
  for (const action of [
    () => assert.equal(commands.updateSection('member', 'beam', 'B', { b: '200' }), undefined),
    () => assert.equal(commands.updateSpring('S', { kr: '100', memo: '  Memo  ' }), undefined),
    () => assert.equal(commands.updateMaterial('M', { E: '200' }), undefined),
    () => assert.equal(commands.addSpring({ symbol: 'S' }), null),
    () => assert.equal(commands.addMaterial({ name: 'Bad', E: -1 }), null),
    () => assert.equal(commands.addSection({ target: 'member', type: 'beam', name: 'Bad', b: -1 }), null),
    () => assert.equal(commands.updateSection('member', 'beam', 'B', { shape: 'boxSection', boxThickness: 900 }), null),
    () => assert.equal(commands.updateMaterial('absent', { E: 200 }), null),
    () => assert.equal(commands.removeSpring('absent'), null),
  ]) assertUnchanged(env, action);
});

test('section property propagation and catalog definition undo together; in-use/default removal is unchanged', () => {
  const env = setup();
  const { state, history, commands } = env;
  state.addSpring({ symbol: 'S', kr: 100 });
  state.addMaterial({ name: 'M', E: 200, G: 80, density: 7000 });
  state.addSection({ target: 'member', type: 'beam', name: 'B', b: 200, h: 400, material: 'M', defaultEndI: { condition: 'spring', springSymbol: 'S' } });
  const a = state.addNode(0, 0), b = state.addNode(1000, 0);
  state.addMember(a.id, b.id, { type: 'beam', sectionName: 'B' });
  const before = content(state);
  commands.updateSection('member', 'beam', 'B', { b: 300 });
  assert.equal(state.members[0].section.b, 300);
  history.undo();
  assert.deepEqual(content(state), before);
  for (const action of [
    () => commands.removeSection('member', 'beam', 'B'),
    () => commands.removeSpring('S'),
    () => commands.removeMaterial('M'),
    () => commands.removeMaterial('steel'),
    () => { const s = state.sectionCatalog.find(s => s.isDefault); return commands.removeSection(s.target, s.type, s.name); },
  ]) assertUnchanged(env, action);
});

test('exceptions after partial staged mutations never reach live state or history', async () => {
  class ThrowingState extends AppState {
    addSpring(entry) { super.addSpring(entry); throw new Error('broken mutation'); }
  }
  const env = setup(ThrowingState);
  preserveRedo(env);
  assertUnchanged(env, () => assert.equal(env.commands.addSpring({ symbol: 'S' }), null));
  await assertUnchanged(env, () => assert.rejects(env.commands.importFile(file({
    userDefinitions: true,
    materials: [{ name: 'M', E: 200, G: 80, density: 7000 }],
    springs: [{ symbol: 'S' }],
  })), /broken mutation/));
});

test('multi-catalog import including built-in material override is a single reversible entry', async () => {
  const { state, history, commands } = setup();
  const before = content(state);
  const payload = {
    userDefinitions: true,
    materials: [{ name: 'steel', E: 190000, G: 75000, density: 7800 }, { name: 'M', E: 200, G: 80, density: 7000 }],
    springs: [{ symbol: 'S', kr: 100 }, { symbol: 'S', kr: 200 }],
    sections: [{ target: 'member', type: 'beam', name: 'B', b: 200, h: 400, material: 'M', defaultEndI: { condition: 'spring', springSymbol: 'S' } }],
  };
  assert.deepEqual(await commands.importFile(file(payload)), { added: 4, skipped: 1 });
  const after = content(state);
  assert.equal(state.getSection('member', 'beam', 'B').defaultEndI.springSymbol, 'S');
  assert.equal(history.undoStack.length, 1);
  history.undo();
  assert.deepEqual(content(state), before);
  history.redo();
  assert.deepEqual(content(state), after);
});

test('empty, duplicate-only, identical default override and malformed imports preserve redo and live state', async () => {
  const env = setup();
  env.state.addSpring({ symbol: 'S' });
  const steel = { ...env.state.getMaterial('steel'), isDefault: false };
  preserveRedo(env);
  for (const payload of [
    { userDefinitions: true },
    { userDefinitions: true, springs: [{ symbol: 'S' }] },
    { userDefinitions: true, materials: [steel] },
  ]) await assertUnchanged(env, async () => assert.equal((await env.commands.importFile(file(payload))).added, 0));
  for (const blob of [
    new Blob(['{bad']), file({ sections: [] }),
    file({ userDefinitions: true, materials: [{ name: 'M', E: 200, G: 80, density: 7000 }], sections: [{ target: 'member', type: 'beam', name: 'Bad', b: -1 }] }),
    file({ userDefinitions: true, springs: [null] }),
    { text: () => Promise.reject(new Error('read failed')) },
  ]) await assertUnchanged(env, () => assert.rejects(env.commands.importFile(blob)));
});

test('import stages against current state after file read; intervening edits survive undo', async () => {
  const { state, history, commands } = setup();
  let resolveRead;
  const pending = commands.importFile({ text: () => new Promise(resolve => { resolveRead = resolve; }) });
  commands.addSpring({ symbol: 'While reading', kr: 100 });
  commands.updateMaterial('steel', { E: 180000 });
  const beforeImport = content(state);
  resolveRead(JSON.stringify({ userDefinitions: true, springs: [{ symbol: 'Imported' }], materials: [{ name: 'steel', E: 190000, G: 75000, density: 7800 }] }));
  assert.deepEqual(await pending, { added: 1, skipped: 1 });
  assert.equal(state.getMaterial('steel').E, 180000);
  assert.equal(history.undoStack.length, 3);
  history.undo();
  assert.deepEqual(content(state), beforeImport);
});

test('pending catalog import rejects a provisional drag and succeeds after cancellation without resurrecting preview coordinates', async t => {
  const { state, history, commands } = setup();
  const node = state.addNode(100, 0);
  history.transact(() => state.updateNode(node.id, { x: 200 }));
  history.undo();
  const committed = captureSnapshot(state);
  const stacks = structuredClone([history.undoStack, history.redoStack]);
  const payload = { userDefinitions: true, springs: [{ symbol: 'Imported' }] };
  let resolveRead;
  const pending = commands.importFile({ text: () => new Promise(resolve => { resolveRead = resolve; }) });
  const manager = { state, history };
  beginDrag(manager);
  t.after(() => finishDrag(manager, false));
  previewNode(manager, node.id, { x: 500 });
  const preview = captureSnapshot(state);
  const rejected = assert.rejects(pending, /finish or cancel.*edit/i);
  resolveRead(JSON.stringify(payload));
  await rejected;
  assert.deepEqual(captureSnapshot(state), preview);
  assert.deepEqual([history.undoStack, history.redoStack], stacks);
  finishDrag(manager, false);
  assert.deepEqual(captureSnapshot(state), committed);
  assert.equal(history.redo(), true);
  assert.equal(state.getNode(node.id).x, 200);

  // Retry must stage against the latest committed state, not the old read or
  // cancelled preview. Undoing the imported definitions keeps that geometry.
  const beforeRetry = captureSnapshot(state);
  assert.deepEqual(await commands.importFile(file(payload)), { added: 1, skipped: 0 });
  assert.ok(state.getSpring('Imported'));
  assert.equal(history.undo(), true);
  assert.deepEqual({ ...captureSnapshot(state).data, revision: beforeRetry.data.revision }, beforeRetry.data);
  assert.equal(state.getNode(node.id).x, 200);
  assert.equal(history.redo(), true);
  assert.ok(state.getSpring('Imported'));
  assert.equal(state.getNode(node.id).x, 200);
});

test('catalog commands also work without history injection', async () => {
  const state = new AppState();
  const commands = createCatalogCommands({ state });
  assert.ok(commands.addSpring({ symbol: 'S' }));
  assert.ok(commands.updateSpring('S', { kr: 100 }));
  assert.ok(commands.removeSpring('S'));
  assert.deepEqual(await commands.importFile(file({ userDefinitions: true, springs: [{ symbol: 'Imported' }] })), { added: 1, skipped: 0 });
});

test('pure table renderer escapes names and memos, protects defaults and renders editable spring presets', () => {
  const state = new AppState();
  state.addSpring({ symbol: '<S"&>', memo: '<script>unsafe</script>' });
  const html = renderCatalogTable({ group: { kind: 'spring' }, items: state.listSprings() });
  assert.ok(html.includes('&lt;S&quot;&amp;&gt;'));
  assert.ok(html.includes('&lt;script&gt;unsafe&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  const builtIn = renderCatalogTable({ group: { kind: 'section', target: 'member', type: 'beam' }, items: state.listSections('member', 'beam') });
  assert.ok(!builtIn.includes('data-action="save-section"'));
  state.addSection({ target: 'member', type: 'beam', name: 'B', b: 200, h: 400 });
  const custom = renderCatalogTable({ group: { kind: 'section', target: 'member', type: 'beam' }, items: [state.getSection('member', 'beam', 'B')], materials: state.listMaterials(), springs: state.listSprings() });
  assert.match(custom, /data-field="defaultEndISpring" style="display:none;"/);
  assert.match(custom, /data-action="calculate-section-row"/);
});
