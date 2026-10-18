import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { buildAnalysisModel } from '../js/analysis-export.js';
import { modelHasContent } from '../js/autosave.js';
import { applyModelImport } from '../js/persistence/model-import.js';
import { captureRecoveryData, captureSnapshot, restoreSnapshot } from '../js/persistence/snapshot.js';
import { beginProvisionalEdit, endProvisionalEdit } from '../js/domain/provisional-edit.js';
import { cadFingerprint, importAnalysisExchange, detachAnalysisExchange, exchangeStatus,
  exportExchange, exportNativeAnalysisModel } from '../js/analysis/exchange-binding.js';

function frame() {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(5000, 0);
  state.addMember(a.id, b.id, { levelId: 'L0' });
  state.addLoad('lineLoad', { x1: 0, y1: 0, x2: 5000, y2: 0, value: 1000, loadCase: 'DL' });
  return state;
}

test('CAD schema 16 and recovery preserve the original without aliasing or stale stamps', async () => {
  const state = frame();
  const original = buildAnalysisModel(state);
  original.custom = { retained: ['release', -1.2] };
  await importAnalysisExchange(state, original);
  original.custom.retained[0] = 'caller edit';
  for (const saved of [JSON.parse(JSON.stringify(state.toJSON())), captureRecoveryData(state)]) {
    assert.equal(saved.schemaVersion, 16);
    const restored = new AppState();
    applyModelImport(saved, restored, null, { preserveCatalogs: false });
    assert.equal((await exchangeStatus(restored)).status, 'current');
    assert.deepEqual(await exportNativeAnalysisModel(restored), state.analysisExchange.model);
    const detachedCopy = exportExchange(restored);
    detachedCopy.model.nodes[0].x = 123;
    assert.notEqual(restored.analysisExchange.model.nodes[0].x, 123);
  }
  assert.equal(state.analysisExchange.model.custom.retained[0], 'release');
});

test('structural changes block native output; archive remains available and undo restores the match', async () => {
  const state = frame(), history = new History(state);
  await importAnalysisExchange(state, buildAnalysisModel(state), history);
  const saved = exportExchange(state);
  history.transact(() => { state.updateNode(2, { x: 5001 }); return true; });
  assert.equal((await exchangeStatus(state)).status, 'stale');
  await assert.rejects(exportNativeAnalysisModel(state), /stale/);
  assert.deepEqual(exportExchange(state), saved);
  history.undo();
  assert.equal((await exchangeStatus(state)).status, 'current');
  history.redo();
  assert.equal((await exchangeStatus(state)).status, 'stale');
  // Importing an envelope never assigns its old original to the changed CAD.
  await importAnalysisExchange(state, saved, history);
  assert.equal((await exchangeStatus(state)).status, 'stale');
});

test('remove and old CAD replacement clear originals and are undoable', async () => {
  const state = frame(), history = new History(state);
  await importAnalysisExchange(state, buildAnalysisModel(state), history);
  const saved = exportExchange(state);
  detachAnalysisExchange(state, history);
  assert.equal(state.analysisExchange, null);
  history.undo();
  assert.deepEqual(exportExchange(state), saved);
  const old = frame().toJSON();
  old.schemaVersion = 15;
  delete old.analysisExchange;
  applyModelImport(old, state, history);
  assert.equal(state.analysisExchange, null);
  history.undo();
  assert.deepEqual(exportExchange(state), saved);
  history.undo();
  assert.equal(state.analysisExchange, null);
});

test('invalid originals are rejected atomically by file load, direct load and history restore', async () => {
  const state = frame(), history = new History(state);
  await importAnalysisExchange(state, buildAnalysisModel(state), history);
  const before = captureSnapshot(state);
  const data = state.toJSON();
  data.analysisExchange.model.elements[0].nodeJ = 999;
  assert.throws(() => applyModelImport(data, state, history), /./);
  assert.deepEqual(captureSnapshot(state), before);
  assert.throws(() => state.loadJSON(data), /./);
  assert.deepEqual(captureSnapshot(state), before);
  const broken = structuredClone(before);
  broken.data.analysisExchange.version = 999;
  assert.throws(() => restoreSnapshot(state, broken), /./);
  assert.deepEqual(captureSnapshot(state), before);
});

test('original-only work is kept by autosave and old snapshots clear the attachment', async () => {
  const state = new AppState();
  await importAnalysisExchange(state, buildAnalysisModel(frame()));
  assert.equal(modelHasContent(captureRecoveryData(state)), true);
  const old = captureSnapshot(frame());
  delete old.data.analysisExchange;
  restoreSnapshot(state, old);
  assert.equal(state.analysisExchange, null);
});

test('CAD binding ignores display and file-name changes but includes all structural channels', async () => {
  const state = frame();
  const before = await cadFingerprint(state);
  state.meta.name = 'Save As';
  state.meta.createdAt = 'new';
  state.nodes[0].label = 'label';
  state.members[0].color = '#ffffff';
  state.settings.showNodeIds = false;
  state.activeLevelId = 'L1';
  state.underlay = { name: 'drawing', entities: [] };
  assert.equal(await cadFingerprint(state), before);
  for (const change of [
    s => { s.nodes[1].x += 0.001; },
    s => { s.members[0].endI = { condition: 'rigid', springSymbol: null }; },
    s => { s.levels[0].z += 1; },
    s => { s.loads[0].value += 1; },
    s => { s.loadCombinations[0].factors.DL += 0.1; },
    s => { s.analysisSettings.massSources.DL = 0.2; },
    s => { s.meta.unit = 'm'; },
    s => { s.materialCatalog.find(m => m.name === 'steel').E = 12345; },
    s => { s.sectionCatalog.find(c => c.name === s.members[0].sectionName).A = 12345; },
    s => { s.addSupport(0, 0, { dx: true }); },
  ]) {
    const altered = frame();
    change(altered);
    assert.notEqual(await cadFingerprint(altered), before);
  }
});

test('stale source stamps survive save/reload and are not regenerated from the current CAD', async () => {
  const state = frame();
  await importAnalysisExchange(state, buildAnalysisModel(state));
  state.updateNode(2, { x: 5100 });
  const restored = new AppState();
  restored.loadJSON(JSON.parse(JSON.stringify(state.toJSON())));
  assert.equal((await exchangeStatus(restored)).status, 'stale');
  await assert.rejects(exportNativeAnalysisModel(restored), /stale/);
});

test('provisional edits prevent import, detach and native export', async () => {
  const state = frame();
  await importAnalysisExchange(state, buildAnalysisModel(state));
  beginProvisionalEdit(state);
  await assert.rejects(importAnalysisExchange(state, buildAnalysisModel(state)), /current edit/);
  assert.throws(() => detachAnalysisExchange(state), /current edit/);
  await assert.rejects(exportNativeAnalysisModel(state), /current edit/);
  endProvisionalEdit(state);
  assert.equal((await exchangeStatus(state)).status, 'current');
});

test('delayed hashing cannot attach or export a model after structural edits', async t => {
  const state = frame();
  await importAnalysisExchange(state, buildAnalysisModel(state));
  const original = exportExchange(state);
  for (const action of [() => importAnalysisExchange(state, buildAnalysisModel(state)), () => exportNativeAnalysisModel(state)]) {
    let finish;
    t.mock.method(globalThis.crypto.subtle, 'digest', (_algorithm, bytes) => {
      const result = Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
      return new Promise(resolve => { finish = () => resolve(result); });
    });
    const pending = action();
    state.updateNode(2, { x: state.nodes[1].x + 1 });
    finish();
    await assert.rejects(pending, /changed/);
    assert.deepEqual(exportExchange(state), original);
    t.mock.restoreAll();
  }
});

test('cancelled requests cannot change the attachment or emit native data', async () => {
  const state = frame();
  await assert.rejects(importAnalysisExchange(state, buildAnalysisModel(state), null, { isCurrent: () => false }), /changed/);
  assert.equal(state.analysisExchange, null);
  await importAnalysisExchange(state, buildAnalysisModel(state));
  await assert.rejects(exportNativeAnalysisModel(state, { isCurrent: () => false }), /changed/);
});
