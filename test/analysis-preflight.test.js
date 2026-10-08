import test from 'node:test';
import assert from 'node:assert/strict';

import { buildAnalysisPreflight } from '../js/analysis-preflight.js';
import { AppState } from '../js/state.js';

function addPlanBeam(state, x1, y1, x2, y2) {
  const n1 = state.addNode(x1, y1);
  const n2 = state.addNode(x2, y2);
  return state.addMember(n1.id, n2.id, {
    type: 'beam',
    levelId: state.levels[0].id,
  });
}

function addSupport(state, x, y, restraints) {
  return state.addSupport(x, y, {
    levelId: state.levels[0].id,
    dx: false,
    dy: false,
    dz: false,
    rx: false,
    ry: false,
    rz: false,
    ...restraints,
  });
}

test('analysis preflight blocks an empty model', () => {
  const report = buildAnalysisPreflight(new AppState());

  assert.equal(report.canExport, false);
  assert.ok(report.issues.some(issue => issue.code === 'no-elements'));
  assert.equal(report.summary.components, 0);
});

test('a fixed support restrains all rigid-body modes of a connected component', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });

  const report = buildAnalysisPreflight(state);

  assert.equal(report.canExport, true);
  assert.equal(report.summary.errors, 0);
  assert.equal(report.summary.components, 1);
});

test('a single pin support leaves three rigid-body modes', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addSupport(state, 0, 0, { dx: true, dy: true, dz: true });

  const report = buildAnalysisPreflight(state);
  const issue = report.issues.find(item => item.code === 'rigid-body-modes');

  assert.equal(report.canExport, false);
  assert.equal(issue.params.modes, 3);
});

test('two pins on one line leave rotation about their common axis', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addSupport(state, 0, 0, { dx: true, dy: true, dz: true });
  addSupport(state, 4000, 0, { dx: true, dy: true, dz: true });

  const report = buildAnalysisPreflight(state);
  const issue = report.issues.find(item => item.code === 'rigid-body-modes');

  assert.equal(report.canExport, false);
  assert.equal(issue.params.modes, 1);
});

test('three non-collinear pins restrain the six rigid-body modes', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addPlanBeam(state, 4000, 0, 0, 3000);
  addPlanBeam(state, 0, 3000, 0, 0);
  for (const [x, y] of [[0, 0], [4000, 0], [0, 3000]]) {
    addSupport(state, x, y, { dx: true, dy: true, dz: true });
  }

  const report = buildAnalysisPreflight(state);

  assert.equal(report.canExport, true);
  assert.ok(!report.issues.some(issue => issue.code === 'rigid-body-modes'));
});

test('every disconnected component is checked independently', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addPlanBeam(state, 10000, 0, 14000, 0);
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });

  const report = buildAnalysisPreflight(state);
  const rigidBodyIssues = report.issues.filter(issue => issue.code === 'rigid-body-modes');

  assert.equal(report.summary.components, 2);
  assert.equal(rigidBodyIssues.length, 1);
  assert.equal(rigidBodyIssues[0].params.component, 2);
  assert.ok(report.issues.some(issue => issue.code === 'multiple-components'));
});

test('undefined solver properties are export blockers', () => {
  const state = new AppState();
  const member = addPlanBeam(state, 0, 0, 4000, 0);
  member.sectionName = 'missing-section';
  state.updateAnalysisSettings({ massSources: { LL: null } });
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });

  const report = buildAnalysisPreflight(state);
  const codes = report.issues.map(issue => issue.code);

  assert.equal(report.canExport, false);
  assert.ok(codes.includes('undefined-sections'));
  assert.ok(codes.includes('undefined-mass-sources'));
});

test('undefined material and rotational spring properties are export blockers', () => {
  const state = new AppState();
  const member = addPlanBeam(state, 0, 0, 4000, 0);
  member.material = 'missing-material';
  member.endI = { condition: 'spring', springSymbol: '_SP' };
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });

  const report = buildAnalysisPreflight(state);
  const codes = report.issues.map(issue => issue.code);

  assert.equal(report.canExport, false);
  assert.ok(codes.includes('undefined-materials'));
  assert.ok(codes.includes('undefined-springs'));
});

test('supports disconnected from every member are reported as warnings', () => {
  const state = new AppState();
  addPlanBeam(state, 0, 0, 4000, 0);
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });
  addSupport(state, 9000, 9000, { dx: true });

  const report = buildAnalysisPreflight(state);

  assert.equal(report.canExport, true);
  assert.ok(report.issues.some(issue => issue.code === 'orphan-supports'));
  assert.equal(report.summary.warnings, 1);
});

test('directional spring preflight requires both resolved bending directions', () => {
  const state = new AppState();
  state.addSpring({ symbol: 'DIRECTIONAL', krY: 1e9, krZ: 'pin' });
  const member = addPlanBeam(state, 0, 0, 4000, 0);
  member.endI = { condition: 'spring', springSymbol: 'DIRECTIONAL' };
  addSupport(state, 0, 0, {
    dx: true, dy: true, dz: true, rx: true, ry: true, rz: true,
  });
  assert.equal(buildAnalysisPreflight(state).canExport, true);

  state.updateSpring('DIRECTIONAL', { krZ: null });
  let report = buildAnalysisPreflight(state);
  assert.equal(report.canExport, false);
  const issue = report.issues.find(item => item.code === 'undefined-springs');
  assert.equal(issue.params.values, 'DIRECTIONAL');
  assert.deepEqual(issue.targets, [{ elementType: 'member', elementId: member.id }]);

  state.updateSpring('DIRECTIONAL', { kr: 'rigid' });
  report = buildAnalysisPreflight(state);
  assert.equal(report.canExport, true);
});
