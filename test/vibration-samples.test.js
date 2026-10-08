import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { applyModelImport } from '../js/persistence/model-import.js';
import { captureRecoveryData, captureSnapshot } from '../js/persistence/snapshot.js';
import { createCatalogCommands } from '../js/ui/user-def/catalog-commands.js';

const fixture = name => JSON.parse(fs.readFileSync(new URL(`./fixtures/vibration/${name}.schema13.json`, import.meta.url)));
const beamName = 'SyntheticBeam';
const floorName = 'SyntheticFloor';
const springName = 'SyntheticEnd';

// Minimal fixtures are generated independently of any project or supplied model.
for (const [name, members, nodes, surfaces] of [['simple', 1, 2, 1], ['split', 2, 3, 2]]) {
  test(`${name}: schema 13 migration preserves geometry, member ends and floor weight`, () => {
    const original = fixture(name);
    const state = new AppState();
    applyModelImport(original, state);
    assert.equal(state.schemaVersion, 15);
    assert.equal(state.members.length, members);
    assert.equal(state.nodes.length, nodes);
    assert.equal(state.surfaces.length, surfaces);
    assert.equal(state.supports.length, 2);
    assert.deepEqual(state.toJSON().nodes, original.nodes);
    assert.deepEqual(state.toJSON().supports, original.supports);
    for (const member of original.members) {
      const saved = state.toJSON().members.find(item => item.id === member.id);
      for (const key of ['startNodeId', 'endNodeId', 'sectionName', 'endI', 'endJ']) {
        assert.deepEqual(saved[key], member[key]);
      }
    }
    for (const surface of original.surfaces) {
      const saved = state.toJSON().surfaces.find(item => item.id === surface.id);
      for (const key of ['x1', 'y1', 'x2', 'y2', 'points', 'unitWeight', 'loadDirection']) {
        assert.deepEqual(saved[key], surface[key]);
      }
    }
    const floor = state.getSection('surface', 'floor', floorName);
    for (const key of ['thickness', 'selfWeightMode', 'additionalWeight']) assert.equal(floor[key], null);
    assert.equal(state.getSection('member', 'beam', beamName).propertySource, null);
    assert.equal(state.getSpring(springName).kr, 4e7);
    assert.equal(state.getSpring(springName).krY, null);
    const restored = new AppState();
    applyModelImport(state.toJSON(), restored);
    assert.deepEqual(restored.toJSON(), state.toJSON());
  });

  test(`${name}: new metadata survives CAD, recovery and undo/redo`, () => {
    const state = new AppState();
    applyModelImport(fixture(name), state);
    const history = new History(state);
    const commands = createCatalogCommands({ state, history });
    assert.ok(commands.updateSpring(springName, { krY: '4e7', krZ: 'pin', kt: 'rigid' }));
    assert.ok(commands.updateSection('member', 'beam', beamName, {
      designation: 'H-160x80x6x8', propertySource: 'computed', Avy: 800, Avz: 720,
    }));
    const oldWeight = state.surfaces[0].unitWeight;
    assert.ok(commands.updateSection('surface', 'floor', floorName, {
      thickness: 75, selfWeightMode: 'fromDensity', additionalWeight: 125,
    }));
    const weight = 480 * 0.075 * 9.80665 + 125;
    assert.ok(state.surfaces.every(surface => Math.abs(surface.unitWeight - weight) < 1e-9));
    history.undo();
    assert.equal(state.getSection('surface', 'floor', floorName).thickness, null);
    assert.ok(state.surfaces.every(surface => surface.unitWeight === oldWeight));
    history.redo();
    assert.ok(state.surfaces.every(surface => Math.abs(surface.unitWeight - weight) < 1e-9));
    state.updateSurface(state.surfaces[0].id, { unitWeight: 99 });
    assert.ok(Math.abs(state.surfaces[0].unitWeight - weight) < 1e-9);
    for (const data of [state.toJSON(), captureRecoveryData(state)]) {
      const restored = new AppState();
      applyModelImport(JSON.parse(JSON.stringify(data)), restored);
      assert.deepEqual(restored.toJSON(), state.toJSON());
      assert.equal(typeof restored.getSpring(springName).krY, 'number');
      assert.equal(restored.getSpring(springName).krZ, 'pin');
      assert.equal(restored.getSpring(springName).kt, 'rigid');
      assert.equal(restored.getSection('member', 'beam', beamName).Avz, 720);
    }
  });
}

test('malformed new catalog values reject the complete import without changing history or model', () => {
  const state = new AppState();
  applyModelImport(fixture('simple'), state);
  const history = new History(state);
  history.save();
  const before = captureSnapshot(state);
  const patches = [
    data => { data.springCatalog.find(s => s.symbol === springName).krY = 0; },
    data => { data.springCatalog.find(s => s.symbol === springName).krZ = -1; },
    data => { data.springCatalog.find(s => s.symbol === springName).kr = '2e8oops'; },
    data => { data.sectionCatalog.find(s => s.name === beamName).propertySource = 'unknown'; },
    data => { data.sectionCatalog.find(s => s.name === beamName).Avy = 0; },
    data => { data.sectionCatalog.find(s => s.name === floorName).thickness = -75; },
    data => { data.sectionCatalog.find(s => s.name === floorName).additionalWeight = -1; },
    data => { data.sectionCatalog.find(s => s.name === floorName).selfWeightMode = 'estimate'; },
  ];
  for (const patch of patches) {
    const data = fixture('split');
    data.schemaVersion = 14;
    patch(data);
    assert.throws(() => applyModelImport(data, state, history));
    assert.deepEqual(captureSnapshot(state), before);
    assert.equal(history.undoStack.length, 1);
    assert.equal(history.redoStack.length, 0);
  }
});
