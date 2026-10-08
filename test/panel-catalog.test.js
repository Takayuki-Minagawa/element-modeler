import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { exportUserDefs, importUserDefs } from '../js/io.js';
import { applyModelImport } from '../js/persistence/model-import.js';
import { captureRecoveryData, captureSnapshot } from '../js/persistence/snapshot.js';
import {
  createDefaultSectionCatalog,
  hydrateSectionCatalog,
  hydrateSpringCatalog,
  normalizeCatalogSectionEntry,
  normalizeSpringEntry,
} from '../js/section-catalog.js';

const floorEntry = {
  target: 'surface', type: 'floor', name: 'Panel', panelDirection: 'y',
  endRotationalSpring: 'PanelKr', edgeSprings: { panelToPanel: 'JointKv', panelToBeam: 'BeamKv' },
};

function panelState() {
  const state = new AppState();
  state.addSpring({ symbol: 'PanelKr', kr: 1e8 });
  state.addSpring({ symbol: 'JointKv', kv: 1000 });
  state.addSpring({ symbol: 'BeamKv', kv: 'rigid' });
  state.addSpring({ symbol: 'UnusedKv', kv: 'pin' });
  state.addSection(floorEntry);
  state.addSurfaceRect(0, 0, 500, 2000, {
    type: 'floor', sectionName: 'Panel', loadDirection: 'x', unitWeight: 750,
  });
  return state;
}

test('vertical spring stiffness is independent of kt and rejects invalid inputs atomically', () => {
  const state = new AppState();
  const spring = state.addSpring({ symbol: 'Vertical', kv: '1.5e3', kt: 250 });
  assert.equal(spring.kv, 1500);
  assert.equal(spring.kt, 250);
  assert.equal(spring.kr, null);
  for (const invalid of [0, -1, Infinity, '0', 'unknown', true, [5], {}]) {
    assert.throws(() => normalizeSpringEntry({ symbol: 'Invalid', kv: invalid }), /Invalid spring stiffness kv/);
    assert.equal(state.updateSpring('Vertical', { kv: invalid, memo: 'must not save' }), null);
    assert.deepEqual(state.getSpring('Vertical'), spring);
  }
  assert.equal(state.updateSpring('Vertical', { kv: 'pin' }).kv, 'pin');
  assert.equal(state.updateSpring('Vertical', { kv: 'rigid' }).kv, 'rigid');
  assert.equal(state.updateSpring('Vertical', { kv: '' }).kv, null);
  assert.throws(() => hydrateSpringCatalog([{ ...state.getSpring('_SP'), kv: 100 }]), /Reserved default spring symbol/);
});

test('panel references are strings and panel direction does not overwrite load direction', () => {
  const state = panelState();
  assert.equal(state.getSurface('S1').loadDirection, 'x');
  assert.equal(state.getSection('surface', 'floor', 'Panel').panelDirection, 'y');
  const before = state.getSection('surface', 'floor', 'Panel');
  for (const patch of [
    { panelDirection: 'twoWay' }, { panelDirection: true }, { endRotationalSpring: 1e8 },
    { edgeSprings: [] }, { edgeSprings: 'JointKv' }, { edgeSprings: { panelToPanel: 1000 } },
    { edgeSprings: { panelToBeam: false } }, { edgeSprings: { typo: 'JointKv' } },
  ]) {
    assert.equal(state.updateSection('surface', 'floor', 'Panel', patch), null);
    assert.deepEqual(state.getSection('surface', 'floor', 'Panel'), before);
  }
  const updated = state.updateSection('surface', 'floor', 'Panel', {
    endRotationalSpring: '  MissingKr  ', edgeSprings: { panelToPanel: ' MissingKv ' },
  });
  assert.equal(updated.endRotationalSpring, 'MissingKr');
  assert.deepEqual(updated.edgeSprings, { panelToPanel: 'MissingKv', panelToBeam: 'BeamKv' });
  assert.equal(state.getSurface('S1').loadDirection, 'x');
  assert.deepEqual(state.updateSection('surface', 'floor', 'Panel', { edgeSprings: null }).edgeSprings,
    { panelToPanel: null, panelToBeam: null });
});

test('surface section nested references are detached from callers, getters, and CAD exports', () => {
  const state = new AppState();
  const entry = structuredClone(floorEntry);
  const added = state.addSection(entry);
  entry.edgeSprings.panelToPanel = 'mutated original';
  added.edgeSprings.panelToBeam = 'mutated result';
  const fetched = state.getSection('surface', 'floor', 'Panel');
  fetched.edgeSprings.panelToPanel = 'mutated getter';
  state.listSections('surface', 'floor').find(s => s.name === 'Panel').edgeSprings.panelToBeam = 'mutated list';
  state.addSurfaceRect(0, 0, 500, 2000, { type: 'floor', sectionName: 'Panel' });
  state.toJSON().sectionCatalog.find(s => s.name === 'Panel').edgeSprings.panelToBeam = 'mutated export';
  assert.deepEqual(state.getSection('surface', 'floor', 'Panel').edgeSprings, floorEntry.edgeSprings);
  const defaults = createDefaultSectionCatalog();
  defaults.find(s => s.name === '_S').edgeSprings.panelToPanel = 'changed';
  assert.equal(defaults.find(s => s.name === '_R').edgeSprings.panelToPanel, null);
  assert.equal(createDefaultSectionCatalog().find(s => s.name === '_S').edgeSprings.panelToPanel, null);
});

test('surface-only spring references survive CAD and recovery and protect spring deletion', () => {
  const state = panelState();
  for (const symbol of ['PanelKr', 'JointKv', 'BeamKv']) assert.equal(state.removeSpring(symbol), false);
  assert.equal(state.removeSpring('UnusedKv'), true);
  state.addSpring({ symbol: 'UnusedKv', kv: 'pin' });
  const saved = state.toJSON();
  assert.equal(saved.schemaVersion, 15);
  assert.deepEqual(saved.springCatalog.map(s => s.symbol), ['_SP', 'PanelKr', 'JointKv', 'BeamKv']);
  for (const data of [saved, captureRecoveryData(state)]) {
    const restored = new AppState();
    applyModelImport(JSON.parse(JSON.stringify(data)), restored);
    assert.deepEqual(restored.getSection('surface', 'floor', 'Panel'), state.getSection('surface', 'floor', 'Panel'));
    assert.equal(restored.getSpring('JointKv').kv, 1000);
    assert.equal(restored.getSpring('BeamKv').kv, 'rigid');
    assert.equal(restored.surfaces[0].loadDirection, 'x');
  }
  state.removeSurface(state.surfaces[0].id);
  assert.equal(state.removeSpring('JointKv'), false, 'unused catalog sections still own their references');
  state.updateSection('surface', 'floor', 'Panel', { endRotationalSpring: '', edgeSprings: null });
  for (const symbol of ['PanelKr', 'JointKv', 'BeamKv']) assert.equal(state.removeSpring(symbol), true);
});

test('schema 14 data gains only unspecified panel/kv fields; invalid declarations reject an import', () => {
  const legacy = new AppState().toJSON();
  legacy.schemaVersion = 14;
  for (const spring of legacy.springCatalog) delete spring.kv;
  for (const section of legacy.sectionCatalog) {
    delete section.panelDirection;
    delete section.endRotationalSpring;
    delete section.edgeSprings;
  }
  const state = new AppState();
  applyModelImport(legacy, state);
  assert.equal(state.schemaVersion, 15);
  const surface = state.getSection('surface', 'floor', '_S');
  assert.equal(surface.panelDirection, null);
  assert.equal(surface.endRotationalSpring, null);
  assert.deepEqual(surface.edgeSprings, { panelToPanel: null, panelToBeam: null });
  assert.equal(state.getSpring('_SP').kv, null);
  assert.throws(() => hydrateSectionCatalog([{ ...surface, panelDirection: 'x' }]), /Reserved default section name/);
  const before = captureSnapshot(state);
  const bad = structuredClone(legacy);
  bad.sectionCatalog.push({ ...floorEntry, endRotationalSpring: 1000 });
  assert.throws(() => applyModelImport(bad, state), /Invalid spring reference/);
  assert.deepEqual(captureSnapshot(state), before);
  const blank = normalizeCatalogSectionEntry({ ...floorEntry, panelDirection: '', endRotationalSpring: '', edgeSprings: null });
  assert.equal(blank.panelDirection, null);
  assert.equal(blank.endRotationalSpring, null);
});

test('panel connection edits undo and redo the entire nested definition without changing floor weights', () => {
  const state = panelState();
  const history = new History(state);
  history.transact(() => state.updateSection('surface', 'floor', 'Panel', {
    panelDirection: 'x', edgeSprings: { panelToPanel: 'UnusedKv', panelToBeam: null },
  }));
  assert.equal(state.getSection('surface', 'floor', 'Panel').edgeSprings.panelToBeam, null);
  history.undo();
  assert.deepEqual(state.getSection('surface', 'floor', 'Panel').edgeSprings, floorEntry.edgeSprings);
  history.redo();
  assert.deepEqual(state.getSection('surface', 'floor', 'Panel').edgeSprings,
    { panelToPanel: 'UnusedKv', panelToBeam: null });
  assert.equal(state.surfaces[0].unitWeight, 750);
});

test('user definition export/import includes unused panel catalogs and their typed spring values', async context => {
  const originalDocument = globalThis.document;
  const originalFileReader = globalThis.FileReader;
  context.after(() => {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalFileReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalFileReader;
  });
  const blobs = [];
  context.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return 'blob:test'; });
  context.mock.method(URL, 'revokeObjectURL', () => {});
  globalThis.document = { createElement: () => ({ click() {} }), body: { appendChild() {}, removeChild() {} } };
  globalThis.FileReader = class {
    readAsText(blob) {
      blob.text().then(text => { this.result = text; this.onload(); });
    }
  };
  const state = panelState();
  state.removeSurface(state.surfaces[0].id);
  assert.equal(exportUserDefs(state), true);
  const restored = new AppState();
  assert.deepEqual(await importUserDefs(blobs[0], restored), { added: 5, skipped: 0 });
  assert.deepEqual(restored.getSection('surface', 'floor', 'Panel'), state.getSection('surface', 'floor', 'Panel'));
  for (const symbol of ['PanelKr', 'JointKv', 'BeamKv', 'UnusedKv']) {
    assert.deepEqual(restored.getSpring(symbol), state.getSpring(symbol));
  }
});
