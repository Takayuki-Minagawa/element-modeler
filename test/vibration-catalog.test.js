import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../js/state.js';
import {
  createDefaultSectionCatalog,
  hydrateSectionCatalog,
  hydrateSpringCatalog,
  normalizeCatalogSectionEntry,
  normalizeSpringEntry,
  resolveSpringStiffness,
  sectionProperties,
} from '../js/section-catalog.js';
import { calculateSurfaceUnitWeight, STANDARD_GRAVITY_M_S2 } from '../js/surface-weight.js';

test('directional springs preserve common fallback, explicit states, and numeric values', () => {
  const common = normalizeSpringEntry({ symbol: 'COMMON', kr: '2.00e8' });
  assert.equal(common.kr, 2e8);
  assert.deepEqual(resolveSpringStiffness(common), { krY: 2e8, krZ: 2e8, kt: null });
  const directional = normalizeSpringEntry({
    symbol: 'DIRECTIONAL', kr: 2e8, krY: 'pin', krZ: 'rigid', kt: '1.5e3',
  });
  assert.deepEqual(resolveSpringStiffness(directional), { krY: 'pin', krZ: 'rigid', kt: 1500 });
  assert.equal(directional.kr, 2e8);
  assert.deepEqual(resolveSpringStiffness({ kr: 'pin', krY: 1e9 }), {
    krY: 1e9, krZ: 'pin', kt: null,
  });
  assert.deepEqual(resolveSpringStiffness({}), { krY: null, krZ: null, kt: null });
});

test('invalid spring data is rejected on load/add and updates leave the entire entry unchanged', () => {
  for (const field of ['kr', 'krY', 'krZ', 'kt']) {
    for (const value of [0, -1, Infinity, NaN, '0', 'bad', true, {}, []]) {
      assert.throws(() => normalizeSpringEntry({ symbol: 'BAD', [field]: value }), /Invalid spring stiffness/);
      assert.throws(() => hydrateSpringCatalog([{ symbol: 'BAD', [field]: value }]), /Invalid spring stiffness/);
    }
  }
  const state = new AppState();
  const original = state.addSpring({ symbol: 'VALID', kr: 2e8, krY: 'pin', memo: 'keep' });
  assert.equal(state.updateSpring('VALID', { krY: 1e9, kt: 0, memo: 'discard' }), null);
  assert.deepEqual(state.getSpring('VALID'), original);
  assert.equal(state.updateSpring('VALID', { krY: '', krZ: 'rigid' }).krY, null);
  assert.deepEqual(resolveSpringStiffness(state.getSpring('VALID')), { krY: 2e8, krZ: 'rigid', kt: null });
});

test('section provenance and shear areas are optional, validated, and separate from effective calculation sources', () => {
  const state = new AppState();
  const section = state.addSection({
    target: 'member', type: 'beam', name: 'H200', b: 100, h: 200,
    shape: 'hSection', webThickness: 3.2, flangeThickness: 4.5,
    designation: ' H-200x100x3.2x4.5 ', propertySource: 'catalog',
    A: 1511, Avy: '500', Avz: 900,
  });
  assert.equal(section.designation, 'H-200x100x3.2x4.5');
  assert.equal(section.propertySource, 'catalog');
  assert.equal(section.Avy, 500);
  assert.equal(section.Avz, 900);
  const effective = sectionProperties(section);
  assert.equal(effective.propertySource.A, 'explicit');
  assert.equal(effective.propertySource.Iy, 'hSection');
  assert.ok(effective.Iy > effective.Iz);
  for (const patch of [{ Avy: 0 }, { Avz: -1 }, { Avy: 'bad' }, { propertySource: 'other' }]) {
    assert.equal(state.updateSection('member', 'beam', 'H200', patch), null);
    assert.deepEqual(state.getSection('member', 'beam', 'H200'), section);
  }
  const cleared = state.updateSection('member', 'beam', 'H200', {
    designation: '', propertySource: '', Avy: null, Avz: '',
  });
  for (const key of ['designation', 'propertySource', 'Avy', 'Avz']) assert.equal(cleared[key], null);
});

test('default and legacy section metadata remain null and reserved defaults cannot hide new definitions', () => {
  for (const section of createDefaultSectionCatalog()) {
    const keys = section.target === 'member'
      ? ['designation', 'propertySource', 'Avy', 'Avz']
      : ['thickness', 'selfWeightMode', 'additionalWeight'];
    for (const key of keys) assert.equal(section[key], null);
  }
  const legacy = normalizeCatalogSectionEntry({ target: 'member', type: 'beam', name: 'OLD' });
  assert.equal(legacy.designation, null);
  assert.equal(legacy.propertySource, null);
  assert.equal(legacy.Avy, null);
  assert.equal(legacy.Avz, null);
  assert.throws(() => hydrateSectionCatalog([
    { ...createDefaultSectionCatalog().find(s => s.name === '_S'), thickness: 100 },
  ]), /Reserved default section name/);
  assert.throws(() => hydrateSpringCatalog([{ symbol: '_SP', krY: 'pin', memo: '回転バネ' }]),
    /Reserved default spring symbol/);
});

test('surface weight converts mm to metres and requires explicit nonnegative additional weight', () => {
  const section = { selfWeightMode: 'fromDensity', thickness: 100, additionalWeight: 333.4 };
  assert.equal(calculateSurfaceUnitWeight(section, { density: 500 }),
    500 * 0.1 * STANDARD_GRAVITY_M_S2 + 333.4);
  assert.equal(calculateSurfaceUnitWeight({ ...section, additionalWeight: 0 }, { density: 500 }),
    500 * 0.1 * STANDARD_GRAVITY_M_S2);
  for (const patch of [{ thickness: null }, { additionalWeight: null }, { selfWeightMode: 'manual' },
    { thickness: 0 }, { additionalWeight: -1 }, { thickness: 1e308 }]) {
    assert.equal(calculateSurfaceUnitWeight({ ...section, ...patch }, { density: 500 }), null);
  }
  assert.equal(calculateSurfaceUnitWeight(section, null), null);
});

test('surface section and material edits propagate totals only when density inputs are complete', () => {
  const state = new AppState();
  state.addMaterial({ name: 'ALC', E: 2100, G: 900, density: 500 });
  state.addSection({
    target: 'surface', type: 'floor', name: 'ALC100', material: 'ALC',
    thickness: 100, selfWeightMode: 'fromDensity', additionalWeight: 0,
  });
  const floor = state.addSurfaceRect(0, 0, 1000, 1000, { type: 'floor', sectionName: 'ALC100', unitWeight: 12 });
  const manual = state.addSurfaceRect(2000, 0, 3000, 1000, { type: 'floor', unitWeight: 500 });
  assert.equal(floor.unitWeight, 500 * 0.1 * STANDARD_GRAVITY_M_S2);
  state.updateMaterial('ALC', { density: 600 });
  assert.equal(floor.unitWeight, 600 * 0.1 * STANDARD_GRAVITY_M_S2);
  assert.equal(manual.unitWeight, 500);
  state.updateSection('surface', 'floor', 'ALC100', { thickness: 150, additionalWeight: 100 });
  const expected = 600 * 0.15 * STANDARD_GRAVITY_M_S2 + 100;
  assert.equal(floor.unitWeight, expected);
  assert.equal(state.removeMaterial('ALC'), false);
  state.updateSection('surface', 'floor', 'ALC100', { additionalWeight: null });
  state.updateMaterial('ALC', { density: 700 });
  assert.equal(floor.unitWeight, expected);
  state.updateSection('surface', 'floor', 'ALC100', { additionalWeight: 0, selfWeightMode: 'manual' });
  assert.equal(floor.unitWeight, expected);
  state.updateSection('surface', 'floor', 'ALC100', { selfWeightMode: 'fromDensity' });
  assert.equal(floor.unitWeight, 700 * 0.15 * STANDARD_GRAVITY_M_S2);
  state.updateSection('surface', 'floor', 'ALC100', { material: 'wood' });
  assert.equal(floor.unitWeight, 500 * 0.15 * STANDARD_GRAVITY_M_S2);
});

test('surface inputs validate atomically and newly provided material completes a pending calculation', () => {
  const state = new AppState();
  const original = state.addSection({
    target: 'surface', type: 'floor', name: 'PENDING', material: 'later',
    thickness: 100, selfWeightMode: 'fromDensity', additionalWeight: 0,
  });
  const floor = state.addSurfaceRect(0, 0, 1000, 1000, { type: 'floor', sectionName: 'PENDING', unitWeight: 123 });
  assert.equal(floor.unitWeight, 123);
  for (const patch of [{ thickness: 0 }, { thickness: false }, { additionalWeight: -1 },
    { additionalWeight: true }, { selfWeightMode: 'automatic' }]) {
    assert.equal(state.updateSection('surface', 'floor', 'PENDING', { material: 'steel', ...patch }), null);
    assert.deepEqual(state.getSection('surface', 'floor', 'PENDING'), original);
    assert.equal(floor.unitWeight, 123);
  }
  state.addMaterial({ name: 'later', E: 2100, G: 900, density: 500 });
  assert.equal(floor.unitWeight, 500 * 0.1 * STANDARD_GRAVITY_M_S2);
});

test('non-numeric material density cannot overwrite a derived surface total', () => {
  const state = new AppState();
  const original = state.addMaterial({ name: 'ALC', E: 2100, G: 900, density: 500 });
  state.addSection({
    target: 'surface', type: 'floor', name: 'ALC100', material: 'ALC',
    thickness: 100, selfWeightMode: 'fromDensity', additionalWeight: 0,
  });
  const floor = state.addSurfaceRect(0, 0, 1000, 1000, { type: 'floor', sectionName: 'ALC100' });
  const originalWeight = floor.unitWeight;
  for (const invalid of [true, false, [500], {}, []]) {
    assert.equal(state.updateMaterial('ALC', { density: invalid }), null);
    assert.deepEqual(state.getMaterial('ALC'), original);
    assert.equal(floor.unitWeight, originalWeight);
  }
});

test('non-numeric shear ratios are rejected instead of becoming numeric areas', () => {
  const state = new AppState();
  const original = state.addSection({ target: 'member', type: 'beam', name: 'RATIO', b: 100, h: 200 });
  for (const field of ['shearAreaRatioY', 'shearAreaRatioZ']) {
    for (const invalid of [true, false, [0.5], {}, []]) {
      assert.equal(state.updateSection('member', 'beam', 'RATIO', { [field]: invalid }), null);
      assert.deepEqual(state.getSection('member', 'beam', 'RATIO'), original);
    }
  }
});
