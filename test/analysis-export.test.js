import test from 'node:test';
import assert from 'node:assert/strict';

import { AppState } from '../js/state.js';
import {
  ANALYSIS_FORMAT_VERSION,
  buildAnalysisCSV,
  buildAnalysisModel,
} from '../js/analysis-export.js';

const FIXED_EXPORT_OPTIONS = {
  generatedAt: '2026-08-08T00:00:00.000Z',
  appVersion: '1.1.0-test',
};

function buildFrame() {
  const state = new AppState();
  const [gl, upper] = [...state.levels].sort((a, b) => a.z - b.z);

  // Two columns and a beam spanning them at the upper level
  const c1 = state.addNode(0, 0);
  state.addMember(c1.id, c1.id, { type: 'column', levelId: gl.id, topLevelId: upper.id });
  const c2 = state.addNode(4000, 0);
  state.addMember(c2.id, c2.id, { type: 'column', levelId: gl.id, topLevelId: upper.id });
  const b1 = state.addNode(0, 0);
  const b2 = state.addNode(4000, 0);
  state.addMember(b1.id, b2.id, { type: 'beam', levelId: upper.id });

  state.addSupport(0, 0, { levelId: gl.id, dx: true, dy: true, dz: true });
  state.addLoad('pointLoad', { x1: 2000, y1: 0, fz: -5000, levelId: upper.id, loadCase: 'LL' });
  return { state, gl, upper };
}

test('buildAnalysisModel merges coincident 3D endpoints into shared nodes', () => {
  const { state, upper } = buildFrame();
  const model = buildAnalysisModel(state);

  // Column tops and beam ends coincide: 2 base + 2 top nodes + support reuses base.
  assert.equal(model.nodes.length, 4);
  assert.equal(model.elements.length, 3);

  const beam = model.elements.find(e => e.type === 'beam');
  const columns = model.elements.filter(e => e.type === 'column');
  const columnTopIds = new Set(columns.map(c => c.nodeJ));
  assert.ok(columnTopIds.has(beam.nodeI));
  assert.ok(columnTopIds.has(beam.nodeJ));

  // Beam nodes carry the upper level elevation.
  const beamNodeI = model.nodes.find(n => n.id === beam.nodeI);
  assert.equal(beamNodeI.z, upper.z);

  // Support attaches to the column base node.
  const columnBaseIds = new Set(columns.map(c => c.nodeI));
  assert.ok(columnBaseIds.has(model.supports[0].nodeId));
});

test('buildAnalysisModel carries sections, load cases and combinations', () => {
  const { state } = buildFrame();
  const model = buildAnalysisModel(state);

  assert.equal(model.units.length, 'mm');
  assert.equal(model.units.lineLoad, 'N/mm');
  assert.equal(model.units.areaLoad, 'N/mm2');
  assert.equal(model.units.moment, 'N*mm');
  assert.equal(model.units.mass, 'kg');
  assert.equal(model.units.density, 'kg/m3');
  assert.ok(model.sections.some(s => s.name === '_G'));
  assert.deepEqual(model.materials.find(material => material.name === 'steel'), {
    name: 'steel', E: 205000, G: 79000, density: 7850, isDefault: true,
  });
  assert.equal(model.loads[0].loadCase, 'LL');
  assert.ok(model.loadCases.includes('EQX'));
  assert.ok(model.loadCombinations.length >= 5);
  assert.deepEqual(model.loadCombinations[0].factors, { DL: 1, LL: 1 });
});

test('load values are converted to the mm-N base system', () => {
  const state = new AppState();
  state.addLoad('lineLoad', { x1: 0, y1: 0, x2: 1000, y2: 0, value: 1000 });      // 1000 N/m
  state.addLoad('areaLoad', { x1: 0, y1: 0, x2: 1000, y2: 1000, value: 2e6 });    // 2e6 N/m²
  state.addLoad('pointLoad', { x1: 0, y1: 0, fz: -5000, mx: 5 });                 // 5 N·m

  const model = buildAnalysisModel(state);
  const line = model.loads.find(l => l.type === 'lineLoad');
  const area = model.loads.find(l => l.type === 'areaLoad');
  const point = model.loads.find(l => l.type === 'pointLoad');
  assert.equal(line.value, 1);        // N/mm
  assert.equal(area.value, 2);        // N/mm²
  assert.equal(point.fz, -5000);      // forces stay in N
  assert.equal(point.mx, 5000);       // N·mm
});

test('cross vertical braces expand into two diagonal elements', () => {
  const state = new AppState();
  const [gl, upper] = [...state.levels].sort((a, b) => a.z - b.z);
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(2000, 0);
  const brace = state.addMember(n1.id, n2.id, {
    type: 'vbrace', levelId: gl.id, topLevelId: upper.id, bracePattern: 'cross',
    endI: { condition: 'rigid' }, endJ: { condition: 'pin' },
  });

  const model = buildAnalysisModel(state);
  assert.equal(model.elements.length, 2);
  assert.equal(model.nodes.length, 4);
  const [d1, d2] = model.elements;
  assert.deepEqual([d1.id, d2.id], [1, 2]);
  assert.equal(d1.sourceId, brace.id);
  assert.equal(d2.sourceId, brace.id);
  assert.equal(d1.sourceBranch, 'primary');
  assert.equal(d2.sourceBranch, 'cross');
  assert.equal(d1.bracePattern, 'cross');
  // The second diagonal mirrors the first: same node set, opposite pairing.
  assert.equal(d2.nodeI, model.nodes.find(n => n.x === 2000 && n.z === gl.z).id);
  assert.equal(d2.nodeJ, model.nodes.find(n => n.x === 0 && n.z === upper.z).id);
  // End conditions follow the plan endpoints: the mirrored diagonal starts at
  // plan point 2, so its end I carries the member's end J condition.
  assert.equal(d1.endI.condition, 'rigid');
  assert.equal(d1.endJ.condition, 'pin');
  assert.equal(d2.endI.condition, 'pin');
  assert.equal(d2.endJ.condition, 'rigid');
});

test('nodes merge by real distance even across rounding-cell boundaries', () => {
  const state = new AppState();
  const a = state.addNode(0.049, 0);
  const b = state.addNode(1000, 0);
  state.addMember(a.id, b.id, { type: 'beam' });
  const c = state.addNode(0.051, 0);
  const d = state.addNode(1000, 1000);
  state.addMember(c.id, d.id, { type: 'beam' });

  const model = buildAnalysisModel(state);
  // 0.049 and 0.051 are 0.002mm apart -> one shared node (3 total).
  assert.equal(model.nodes.length, 3);
});

test('nodes at the tolerance merge even when hash cells are two apart', () => {
  const state = new AppState();
  // 0.15 rounds down to cell 1 while 0.25 rounds up to cell 3: the pair is
  // exactly one tolerance apart but their rounded cell indices differ by 2,
  // so the neighborhood scan must reach beyond the adjacent cells.
  const a = state.addNode(0.15, 0);
  const b = state.addNode(1000, 0);
  state.addMember(a.id, b.id, { type: 'beam' });
  const c = state.addNode(0.25, 0);
  const d = state.addNode(1000, 1000);
  state.addMember(c.id, d.id, { type: 'beam' });

  const model = buildAnalysisModel(state);
  assert.equal(model.nodes.length, 3);
});

test('nodes exactly at the merge tolerance still merge', () => {
  const state = new AppState();
  // 0.4 - 0.3 overshoots 0.1 by a few ULP in floating point; the pool must
  // still treat the pair as exactly-at-tolerance and merge it.
  const a = state.addNode(0.3, 0);
  const b = state.addNode(1000, 0);
  state.addMember(a.id, b.id, { type: 'beam' });
  const c = state.addNode(0.4, 0);
  const d = state.addNode(1000, 1000);
  state.addMember(c.id, d.id, { type: 'beam' });

  const model = buildAnalysisModel(state);
  assert.equal(model.nodes.length, 3);
});

test('zero-length elements are dropped after 3D resolution', () => {
  const state = new AppState();
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(0, 0);
  state.addMember(n1.id, n2.id, { type: 'beam' });

  const model = buildAnalysisModel(state);
  assert.equal(model.elements.length, 0);
});

test('buildAnalysisCSV renders node/element/section/support/load/combo sections', () => {
  const { state } = buildFrame();
  const csv = buildAnalysisCSV(state, FIXED_EXPORT_OPTIONS);

  assert.match(csv, /^section,id/);
  assert.match(csv, /\r\nmeta,version,2,/);
  assert.match(csv, /\r\nmeta,generator_name,element-modeler,/);
  assert.match(csv, /\r\nmeta,generator_app_version,1\.1\.0-test,/);
  assert.match(csv, /\r\nmeta,warning_undefined_mass_sources,0,/);
  assert.match(csv, /\r\nunit,density,kg\/m3,/);
  assert.match(csv, /\r\nnode,1,/);
  assert.match(csv, /\r\nelement_header,id,type,node_i,node_j,section,material,b_mm,h_mm,end_i,end_j,roof_role,source_id,source_branch,section_id/);
  assert.match(csv, /\r\nelement,3,beam,.*M3,primary/);
  assert.match(csv, /\r\nsect_header,name,type,material,b_mm,h_mm,A_mm2,Iy_mm4,Iz_mm4,J_mm4,is_default,A_source,Iy_source,Iz_source,J_source,section_id/);
  assert.match(csv, /\r\nsect,_G,.*rectangle,rectangle,rectangle,rectangle/);
  assert.match(csv, /\r\nmaterial,steel,205000,79000,7850,1/);
  assert.match(csv, /\r\nspring_header,symbol,memo,kr_N_mm_rad,kt_N_mm/);
  assert.match(csv, /\r\nsupport,1,1,.*SUP1/);
  assert.match(csv, /\r\nload_header,id,type,case,unit,/);
  assert.match(csv, /\r\nload,1,pointLoad,LL,N;N\*mm,.*LD1/);
  assert.match(csv, /\r\nmass_source,LL,0\.3,/);
  assert.match(csv, /\r\nself_weight_header,mode,is_default,/);
  assert.match(csv, /\r\ncombo,LC1,G\+P,DL=1;LL=1/);
});

test('buildAnalysisCSV element rows carry section dimensions', () => {
  const { state } = buildFrame();
  const model = buildAnalysisModel(state);
  const beam = model.elements.find(e => e.type === 'beam');
  const csv = buildAnalysisCSV(state);
  const row = csv.split('\r\n').find(line => line.startsWith(`element,${beam.id},`));
  const cells = row.split(',');
  assert.equal(Number(cells[7]), beam.b);
  assert.equal(Number(cells[8]), beam.h);
});

test('v2 assigns unique numeric ids while preserving source ids', () => {
  const { state } = buildFrame();
  const model = buildAnalysisModel(state, FIXED_EXPORT_OPTIONS);

  assert.equal(model.version, ANALYSIS_FORMAT_VERSION);
  assert.deepEqual(model.elements.map(element => element.id), [1, 2, 3]);
  assert.deepEqual(model.elements.map(element => element.sourceId), ['M1', 'M2', 'M3']);
  assert.deepEqual(model.supports.map(support => support.id), [1]);
  assert.deepEqual(model.supports.map(support => support.sourceId), ['SUP1']);
  assert.deepEqual(model.loads.map(load => load.id), [1]);
  assert.deepEqual(model.loads.map(load => load.sourceId), ['LD1']);
  assert.equal(new Set(model.elements.map(element => element.id)).size, model.elements.length);
});

test('v2 metadata declares provenance, coordinates, units, and node order', () => {
  const { state } = buildFrame();
  const model = buildAnalysisModel(state, FIXED_EXPORT_OPTIONS);

  assert.deepEqual(model.meta.generator, {
    name: 'element-modeler',
    formatVersion: 2,
    appVersion: '1.1.0-test',
  });
  assert.equal(model.meta.generatedAt, FIXED_EXPORT_OPTIONS.generatedAt);
  assert.deepEqual(model.meta.coordinates, { verticalAxis: 'z', handedness: 'right' });
  assert.equal(model.meta.nodeOrder, 'ascending-id');
  assert.deepEqual(model.nodes.map(node => node.id), [1, 2, 3, 4]);
});

test('rectangle section properties match hand calculations and allow explicit overrides', () => {
  const state = new AppState();
  state.addSection({
    target: 'member', type: 'beam', name: 'RECT', material: 'steel', b: 200, h: 400,
  });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(4000, 0);
  state.addMember(n1.id, n2.id, { type: 'beam', sectionName: 'RECT' });

  let section = buildAnalysisModel(state).sections.find(item => item.name === 'RECT');
  assert.equal(section.A, 80000);
  assert.equal(section.Iy, 200 * 400 ** 3 / 12);
  assert.equal(section.Iz, 400 * 200 ** 3 / 12);
  assert.ok(Math.abs(section.J - 732416666.6666666) < 1e-6);
  assert.deepEqual(section.propertySource, {
    A: 'rectangle', Iy: 'rectangle', Iz: 'rectangle', J: 'rectangle',
  });

  state.updateSection('member', 'beam', 'RECT', {
    A: 81000, Iy: 1.1e9, Iz: 2.8e8, J: 8e8,
  });
  section = buildAnalysisModel(state).sections.find(item => item.name === 'RECT');
  assert.deepEqual(
    { A: section.A, Iy: section.Iy, Iz: section.Iz, J: section.J },
    { A: 81000, Iy: 1.1e9, Iz: 2.8e8, J: 8e8 }
  );
  assert.deepEqual(section.propertySource, {
    A: 'explicit', Iy: 'explicit', Iz: 'explicit', J: 'explicit',
  });
});

test('section ids disambiguate equal names across member types and only used definitions export', () => {
  const state = new AppState();
  state.addSection({
    target: 'member', type: 'beam', name: 'DUP', material: 'steel', b: 200, h: 400,
  });
  state.addSection({
    target: 'member', type: 'column', name: 'DUP', material: 'rc', b: 300, h: 300,
  });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(4000, 0);
  state.addMember(n1.id, n2.id, { type: 'beam', sectionName: 'DUP' });

  let model = buildAnalysisModel(state);
  assert.deepEqual(model.sections.map(section => [section.type, section.name]), [['beam', 'DUP']]);
  assert.equal(model.elements[0].sectionId, model.sections[0].id);

  const n3 = state.addNode(8000, 0);
  state.addMember(n3.id, n3.id, {
    type: 'column', sectionName: 'DUP', levelId: state.levels[0].id,
    topLevelId: state.levels[1].id,
  });
  model = buildAnalysisModel(state);
  const sectionsByType = new Map(model.sections.map(section => [section.type, section]));
  assert.equal(sectionsByType.size, 2);
  for (const element of model.elements) {
    assert.equal(element.sectionId, sectionsByType.get(element.type).id);
  }
});

test('section reference keys cannot collide when imported names contain separator characters', () => {
  const state = new AppState();
  const definitions = [
    { type: 'beam\u0000X', name: 'Y' },
    { type: 'beam', name: 'X\u0000Y' },
  ];
  definitions.forEach((definition, index) => {
    state.addSection({
      target: 'member', ...definition, material: 'steel', b: 200 + index, h: 400,
    });
    const n1 = state.addNode(index * 2000, 0);
    const n2 = state.addNode(index * 2000 + 1000, 0);
    state.addMember(n1.id, n2.id, {
      type: definition.type, sectionName: definition.name,
    });
  });

  const model = buildAnalysisModel(state);
  assert.equal(model.sections.length, 2);
  for (const element of model.elements) {
    const section = model.sections.find(item =>
      item.type === element.type && item.name === element.sectionName
    );
    assert.equal(element.sectionId, section.id);
  }
});

test('used springs export stiffness and flag an undefined rotational value', () => {
  const state = new AppState();
  state.addSpring({ symbol: 'K1', kt: 500 });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(1000, 0);
  state.addMember(n1.id, n2.id, {
    type: 'beam', endI: { condition: 'spring', springSymbol: 'K1' },
  });

  let model = buildAnalysisModel(state);
  assert.deepEqual(model.springs[0], {
    symbol: 'K1', kr: null, krY: null, krZ: null, kt: 500, kv: null, memo: '', isDefault: false,
  });
  assert.equal(model.meta.warnings.undefinedSpringStiffness, true);
  assert.deepEqual(model.meta.warnings.undefinedSpringSymbols, ['K1']);

  state.updateSpring('K1', { kr: 120000 });
  model = buildAnalysisModel(state);
  assert.equal(model.springs[0].kr, 120000);
  assert.equal(model.meta.warnings.undefinedSpringStiffness, false);
});

test('directional spring stiffness preserves explicit releases and legacy fallback in JSON and CSV', () => {
  const state = new AppState();
  state.addSpring({ symbol: 'DIRECTIONAL', kr: 2e8, krY: 'pin', krZ: 3e8, kt: 'rigid' });
  const start = state.addNode(0, 0);
  const end = state.addNode(1000, 0);
  state.addMember(start.id, end.id, {
    type: 'beam', endI: { condition: 'spring', springSymbol: 'DIRECTIONAL' },
  });
  let model = buildAnalysisModel(state);
  assert.deepEqual(model.springs[0], {
    symbol: 'DIRECTIONAL', kr: 2e8, krY: 'pin', krZ: 3e8, kt: 'rigid', kv: null, memo: '', isDefault: false,
  });
  assert.equal(model.meta.warnings.undefinedSpringStiffness, false);
  assert.equal(model.units.rotationalStiffness, 'N*mm/rad');
  assert.equal(model.units.translationalStiffness, 'N/mm');
  const csv = buildAnalysisCSV(state, { model });
  assert.match(csv, /\r\nspring_header,symbol,memo,kr_N_mm_rad,kt_N_mm,is_default,krY_N_mm_rad,krZ_N_mm_rad,/);
  assert.match(csv, /\r\nspring,DIRECTIONAL,,200000000,rigid,0,pin,300000000,/);

  state.updateSpring('DIRECTIONAL', { kr: 'rigid', krY: null, krZ: null });
  model = buildAnalysisModel(state);
  assert.equal(model.springs[0].kr, 'rigid');
  assert.equal(model.springs[0].krY, null);
  assert.equal(model.springs[0].krZ, null);
  assert.equal(model.meta.warnings.undefinedSpringStiffness, false);

  state.updateSpring('DIRECTIONAL', { kr: null, krY: 'pin', krZ: 'rigid' });
  assert.equal(buildAnalysisModel(state).meta.warnings.undefinedSpringStiffness, false);
  state.updateSpring('DIRECTIONAL', { krZ: null });
  assert.deepEqual(buildAnalysisModel(state).meta.warnings.undefinedSpringSymbols, ['DIRECTIONAL']);
});

test('section exchange metadata preserves v2 provenance and explicit shear areas take precedence', () => {
  const state = new AppState();
  state.addSection({
    target: 'member', type: 'beam', name: 'DECLARED', b: 100, h: 200,
    designation: 'CUSTOM-200x100', propertySource: 'catalog', A: 21000,
    Avy: 15000, Avz: null, shearAreaRatioY: 0.5, shearAreaRatioZ: 0.25,
  });
  const start = state.addNode(0, 0);
  const end = state.addNode(1000, 0);
  state.addMember(start.id, end.id, { type: 'beam', sectionName: 'DECLARED' });
  const model = buildAnalysisModel(state);
  const section = model.sections[0];
  assert.equal(section.designation, 'CUSTOM-200x100');
  assert.equal(section.declaredPropertySource, 'catalog');
  assert.deepEqual(section.propertySource, {
    A: 'explicit', Iy: 'rectangle', Iz: 'rectangle', J: 'rectangle',
  });
  assert.equal(section.Avy, 15000);
  assert.equal(section.Avz, null);
  assert.equal(section.Ay, 15000);
  assert.equal(section.Az, 5250);
  assert.equal(section.shearAreaRatioY, 0.5);
  const rows = buildAnalysisCSV(state, { model }).trim().split('\r\n').map(row => row.split(','));
  assert.ok(rows.every(row => row.length === 28));
  const header = rows.find(row => row[0] === 'sect_header');
  const data = rows.find(row => row[0] === 'sect');
  assert.equal(header[24], 'designation');
  assert.deepEqual(data.slice(24), ['CUSTOM-200x100', 'catalog', '15000', '']);
});

test('mass-source defaults and overrides are exported with undefined detection', () => {
  const state = new AppState();
  let model = buildAnalysisModel(state);
  assert.deepEqual(model.massSources, { DL: 1, LL: 0.3, EQX: 0, EQY: 0, WX: 0, WY: 0 });
  assert.deepEqual(model.selfWeight, { mode: 'fromDensity', isDefault: true });
  assert.equal(model.meta.warnings.undefinedMassSources, false);

  state.updateAnalysisSettings({ massSources: { LL: 0.25 } });
  model = buildAnalysisModel(state);
  assert.deepEqual(model.selfWeight, { mode: 'fromDensity', isDefault: true });

  state.updateAnalysisSettings({
    massSources: { WX: null },
    selfWeightMode: 'includedInDL',
  });
  model = buildAnalysisModel(state);
  assert.equal(model.massSources.LL, 0.25);
  assert.equal(model.massSources.WX, null);
  assert.deepEqual(model.selfWeight, { mode: 'includedInDL', isDefault: false });
  assert.equal(model.meta.warnings.undefinedMassSources, true);
  assert.deepEqual(model.meta.warnings.undefinedMassSourceCases, ['WX']);
});

test('unknown material properties remain null and are machine-readable warnings', () => {
  const state = new AppState();
  state.addSection({
    target: 'member', type: 'beam', name: 'UNKNOWN_MAT', material: 'project-material', b: 100, h: 200,
  });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(1000, 0);
  state.addMember(n1.id, n2.id, { type: 'beam', sectionName: 'UNKNOWN_MAT' });

  const model = buildAnalysisModel(state);
  assert.deepEqual(model.materials[0], {
    name: 'project-material', E: null, G: null, density: null, isDefault: false,
  });
  assert.equal(model.meta.warnings.undefinedMaterialProperties, true);
  assert.deepEqual(model.meta.warnings.undefinedMaterialNames, ['project-material']);
});
