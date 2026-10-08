import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/state.js';
import { buildAnalysisModel, buildAnalysisCSV } from '../js/analysis-export.js';
import { buildAnalysisPreflight } from '../js/analysis-preflight.js';
import { normalizeAnalysisSettings, isDefaultAnalysisSettings } from '../js/analysis-settings.js';

function panelModel() {
  const state = new AppState();
  state.addSpring({ symbol: 'PanelEnd', krY: 2e7 });
  state.addSpring({ symbol: 'Edge', kv: 250 });
  state.addMaterial({ name: 'panel', E: 2000, G: 800, density: 600 });
  state.addSection({ target: 'surface', type: 'floor', name: 'P', material: 'panel',
    thickness: 80, selfWeightMode: 'fromDensity', additionalWeight: 125,
    panelDirection: 'y', endRotationalSpring: 'PanelEnd',
    edgeSprings: { panelToPanel: 'Edge', panelToBeam: 'Edge' } });
  state.addSurfaceRect(0, 0, 400, 1600, { type: 'floor', sectionName: 'P', loadDirection: 'x' });
  return state;
}

test('analysis export preserves panel references, panel-only materials/springs and mm-N weight units', () => {
  const state = panelModel();
  const model = buildAnalysisModel(state);
  assert.deepEqual(model.meta.warnings.undefinedSpringSymbols, []);
  assert.equal(model.materials.find(m => m.name === 'panel').density, 600);
  assert.deepEqual(model.springs.map(s => [s.symbol, s.krY, s.kv]), [['PanelEnd', 2e7, null], ['Edge', null, 250]]);
  assert.equal(model.surfaceSections[0].additionalWeight, 125 / 1e6);
  assert.equal(model.surfaceSections[0].panelDirection, 'y');
  assert.equal(model.surfaces[0].loadDirection, 'x');
  assert.equal(model.surfaces[0].unitWeight, (600 * 0.08 * 9.80665 + 125) / 1e6);
  model.surfaceSections[0].edgeSprings.panelToBeam = 'mutated';
  assert.equal(state.getSection('surface', 'floor', 'P').edgeSprings.panelToBeam, 'Edge');
  const csv = buildAnalysisCSV(state);
  assert.match(csv, /krY_N_mm_rad,krZ_N_mm_rad,kv_N_mm/);
  assert.match(csv, /surface_sect,P,floor,panel,80,fromDensity,0\.000125,y,PanelEnd,Edge,Edge/);
  assert.match(csv, /surface,S1,floor,P,/);
});

test('preflight identifies missing and wrongly specified panel springs at their surface', () => {
  const state = panelModel();
  state.updateSpring('Edge', { kv: null, kt: 250 });
  let result = buildAnalysisPreflight(state);
  assert.deepEqual(result.model.meta.warnings.undefinedSpringSymbols, ['Edge']);
  assert.deepEqual(result.issues.find(issue => issue.code === 'undefined-springs').targets,
    [{ elementType: 'surface', elementId: 'S1' }]);
  state.updateSpring('Edge', { kv: 'pin' });
  state.updateSection('surface', 'floor', 'P', { endRotationalSpring: 'Missing' });
  result = buildAnalysisPreflight(state);
  assert.deepEqual(result.model.meta.warnings.undefinedSpringSymbols, ['Missing']);
  state.updateSection('surface', 'floor', 'P', { endRotationalSpring: 'Edge' });
  assert.deepEqual(buildAnalysisModel(state).meta.warnings.undefinedSpringSymbols, ['Edge']);
});

test('explicit shear assumptions survive roundtrip/export; old data stays unspecified', () => {
  const state = new AppState();
  assert.equal(state.analysisSettings.ignoreShearDeformation, null);
  assert.equal(isDefaultAnalysisSettings(state.analysisSettings), true);
  for (const value of [true, false, null]) {
    state.updateAnalysisSettings({ ignoreShearDeformation: value });
    const restored = new AppState();
    restored.loadJSON(state.toJSON());
    assert.equal(restored.analysisSettings.ignoreShearDeformation, value);
    assert.equal(buildAnalysisModel(restored).analysisSettings.ignoreShearDeformation, value);
    assert.ok(buildAnalysisCSV(restored).includes(`analysis_setting,ignore_shear_deformation,${value ?? ''},`));
    assert.equal(isDefaultAnalysisSettings(restored.analysisSettings), value === null);
  }
  assert.throws(() => normalizeAnalysisSettings({ ignoreShearDeformation: 'false' }), /boolean or null/);
  assert.equal(normalizeAnalysisSettings({ massSources: { DL: true } }).massSources.DL, null);
});
