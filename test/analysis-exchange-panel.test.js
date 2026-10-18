import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { buildAnalysisModel } from '../js/analysis-export.js';
import { initAnalysisExchangePanel } from '../js/analysis/exchange-panel.js';

class DomNode {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.style = {};
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(n => n.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  find(predicate) { return [this, ...this.children.flatMap(n => n.find(predicate))].filter(predicate); }
  emit(event) { return this.listeners.get(event)?.(); }
  click() { if (!this.disabled) return this.emit('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function settle(ui) {
  for (let count = 0; count < 100; count++) {
    await new Promise(resolve => setImmediate(resolve));
    if (!ui.byId('analysis-exchange-binding').textContent.includes('確認中')) return;
  }
  assert.fail('Exchange status did not settle');
}
function panel(t) {
  const doc = { createElement: tag => new DomNode(tag, doc) };
  doc.body = doc.createElement('body');
  const host = doc.createElement('div'); doc.body.append(host);
  const state = new AppState(), history = new History(state), downloads = [];
  const a = state.addNode(0, 0), b = state.addNode(3000, 0);
  state.addMember(a.id, b.id);
  const original = buildAnalysisModel(state);
  original.meta.retainedByExtension = { text: '<b>not markup</b>', values: [1, 2, 3] };
  t.mock.method(URL, 'createObjectURL', blob => { downloads.push(blob); return `blob:exchange-${downloads.length}`; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  let api;
  api = initAnalysisExchangePanel({ state, history, host, onModelChange: () => api.modelChanged() });
  const byId = id => doc.body.find(n => n.id === id)[0];
  const open = () => byId('btn-analysis-exchange').click();
  const close = () => byId('btn-exchange-close').click();
  const upload = value => {
    const input = byId('analysis-exchange-file');
    input.files = [{ text: typeof value === 'function' ? value : async () => JSON.stringify(value) }];
    return input.emit('change');
  };
  const edit = () => {
    history.transact(() => state.updateNode(state.nodes[1].id, { x: 4000 }));
    api.modelChanged();
  };
  const undo = () => { history.undo(); api.modelChanged(); };
  open(); t.after(() => api.dispose());
  return { state, history, api, original, byId, upload, open, close, edit, undo, downloads };
}

test('exchange panel imports, summarizes, exports both formats, detects CAD changes and restores with Undo', async t => {
  const ui = panel(t);
  await ui.upload(ui.original); await settle(ui);
  assert.match(ui.byId('analysis-exchange-binding').textContent, /一致しています/);
  assert.match(ui.byId('analysis-exchange-summary').textContent, /element-modeler-analysis-v2/);
  assert.equal(ui.byId('btn-exchange-native').disabled, false);
  ui.byId('btn-exchange-save').click();
  assert.deepEqual(JSON.parse(await ui.downloads[0].text()).model, ui.original);
  await ui.byId('btn-exchange-native').click();
  assert.deepEqual(JSON.parse(await ui.downloads[1].text()), ui.original);
  ui.edit(); await settle(ui);
  assert.match(ui.byId('analysis-exchange-binding').textContent, /一致しません/);
  assert.equal(ui.byId('btn-exchange-native').disabled, true);
  assert.equal(ui.byId('btn-exchange-save').disabled, false);
  ui.byId('btn-exchange-save').click();
  assert.deepEqual(JSON.parse(await ui.downloads[2].text()).model, ui.original);
  ui.undo(); await settle(ui);
  assert.equal(ui.byId('btn-exchange-native').disabled, false);
  ui.byId('btn-exchange-detach').click(); await settle(ui);
  assert.equal(ui.state.analysisExchange, null);
  assert.equal(ui.byId('btn-exchange-save').disabled, true);
  ui.undo(); await settle(ui);
  assert.deepEqual(ui.state.analysisExchange.model, ui.original);
  assert.equal(ui.byId('btn-exchange-native').disabled, false);
});

test('invalid JSON and invalid references leave the previous attachment and history unchanged', async t => {
  const ui = panel(t);
  await ui.upload(ui.original); await settle(ui);
  const before = structuredClone(ui.state.analysisExchange), depth = ui.history.undoStack.length;
  await ui.upload(async () => '{'); await settle(ui);
  assert.match(ui.byId('analysis-exchange-notice').textContent, /処理できません/);
  assert.deepEqual(ui.state.analysisExchange, before);
  const malformed = structuredClone(ui.original);
  malformed.elements[0].nodeI = 999;
  await ui.upload(malformed); await settle(ui);
  assert.match(ui.byId('analysis-exchange-notice').textContent, /処理できません/);
  assert.deepEqual(ui.state.analysisExchange, before);
  assert.equal(ui.history.undoStack.length, depth);
});

test('a delayed file cannot replace the attachment after a newer import or a closed dialog', async t => {
  const ui = panel(t), first = deferred();
  const pending = ui.upload(() => first.promise);
  const newer = structuredClone(ui.original); newer.meta.name = 'newer';
  await ui.upload(newer); await settle(ui);
  first.resolve(JSON.stringify(ui.original)); await pending;
  assert.deepEqual(ui.state.analysisExchange.model, newer);
  const closing = deferred(), pendingClose = ui.upload(() => closing.promise);
  ui.close(); ui.open();
  closing.resolve(JSON.stringify(ui.original)); await pendingClose; await settle(ui);
  assert.deepEqual(ui.state.analysisExchange.model, newer);
});

test('a delayed file cannot attach after CAD edits, and a pending export cannot download stale data', async t => {
  const ui = panel(t), delayedFile = deferred();
  const pendingImport = ui.upload(() => delayedFile.promise);
  ui.edit(); delayedFile.resolve(JSON.stringify(ui.original)); await pendingImport; await settle(ui);
  assert.equal(ui.state.analysisExchange, null);
  await ui.upload(ui.original); await settle(ui);
  const digest = deferred(), reached = deferred();
  let hold = true;
  t.mock.method(globalThis.crypto.subtle, 'digest', async (_algorithm, bytes) => {
    const result = Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
    if (hold) { hold = false; reached.resolve(); await digest.promise; }
    return result;
  });
  const pendingExport = ui.byId('btn-exchange-native').click();
  await reached.promise;
  ui.history.transact(() => ui.state.updateNode(ui.state.nodes[1].id, { x: 5000 }));
  ui.api.modelChanged();
  digest.resolve(); await pendingExport; await settle(ui);
  assert.equal(ui.downloads.length, 0);
  assert.equal(ui.byId('btn-exchange-native').disabled, true);
});

test('superseded status checks cannot re-enable original export', async t => {
  const ui = panel(t);
  await ui.upload(ui.original); await settle(ui);
  const digest = deferred(), reached = deferred();
  let hold = true;
  t.mock.method(globalThis.crypto.subtle, 'digest', async (_algorithm, bytes) => {
    const result = Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
    if (hold) { hold = false; reached.resolve(); await digest.promise; }
    return result;
  });
  ui.close(); ui.open(); await reached.promise;
  ui.edit(); await settle(ui);
  digest.resolve(); await new Promise(resolve => setImmediate(resolve));
  assert.match(ui.byId('analysis-exchange-binding').textContent, /一致しません/);
  assert.equal(ui.byId('btn-exchange-native').disabled, true);
});
