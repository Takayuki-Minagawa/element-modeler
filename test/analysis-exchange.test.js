import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/state.js';
import { buildAnalysisModel } from '../js/analysis-export.js';
import {
  CAD_FINGERPRINT_VERSION, EXCHANGE_FORMAT, EXCHANGE_VERSION,
  createExchange, summarizeExchange, validateExchange,
} from '../js/analysis/exchange.js';

const stamp = `sha256:${'ab'.repeat(32)}`;

function nativeModel() {
  return {
    schema_version: '1', units: { length: 'm', force: 'N', time: 's' },
    metadata: { source: 'independent solver', coordinates: { verticalAxis: 'y' } },
    model: {
      name: 'coincident connection', ndm: 2, ndf: 3,
      nodes: [
        { tag: 1, x: 0, y: 0, z: 0 }, { tag: 101, x: 0, y: 0, z: 0 },
        { tag: 2, x: 0, y: 3, z: 0 }, { tag: 102, x: 0, y: 3, z: 0 },
      ],
      elements: [
        { type: 'zeroLengthSpring2D', tag: 900, node_i: 1, node_j: 101, kx: 0, ky: 2e8, kr: 0 },
        { type: 'elasticBeamColumn2D', tag: 1, node_i: 101, node_j: 2,
          area: 0.02, elastic_modulus: 1e10, inertia: 0.0001, releases: ['rz_i'] },
      ],
      supports: [{ node_tag: 1, fixity: [true, true, true] }],
      nodal_masses: [{ node_tag: 2, mass: [100, 100, 0] }],
      constraints: [{ kind: 'equalDOF', slave_node_tag: 102, slave_dof: 1,
        terms: [{ node_tag: 2, dof: 1, coefficient: 1 }] }],
      groups: { wall: { nodes: [2, 102], elements: [1] } }, inactive_elements: [900],
    },
    load_cases: [
      { name: 'G', nodal_loads: [{ node_tag: 2, fx: 0, fy: -1000, mz: 0 }],
        element_loads: [{ type: 'beamUniform', element_tag: 1, wx: -100, wy: 0 }] },
      { name: 'Q_floor', nodal_loads: [{ node_tag: 2, fy: -300 }] },
      { name: 'E_AU_minus', nodal_displacements: [{ node_tag: 102, ux: -0.001 }] },
    ],
    load_combinations: [{ name: 'custom design', factors: { G: 1.2, Q_floor: 1.5, E_AU_minus: -1 } }],
    extension: { nested: ['retain', { authorDefined: true, optional: null }], ratio: 1.2345678901234567 },
  };
}

function cadAnalysis() {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(3000, 0);
  state.addMember(a.id, b.id, { levelId: 'L0' });
  state.addLoad('pointLoad', { x1: 3000, y1: 0, fz: -1000, loadCase: 'DL' });
  return buildAnalysisModel(state);
}

test('native input preserves coincident nodes, zero-length springs, MPC, releases, units and arbitrary combinations', () => {
  const original = nativeModel(), before = structuredClone(original);
  const exchange = createExchange(original, stamp);
  assert.equal(exchange.format, EXCHANGE_FORMAT);
  assert.equal(exchange.version, EXCHANGE_VERSION);
  assert.equal(exchange.sourceCad.fingerprintVersion, CAD_FINGERPRINT_VERSION);
  assert.equal(exchange.modelFormat, 'fem-struct-pygo-v1');
  assert.deepEqual(exchange.model, before);
  const reloaded = validateExchange(JSON.parse(JSON.stringify(exchange)));
  assert.deepEqual(reloaded.model, before);
  assert.deepEqual(original, before);
  original.model.nodes[0].x = 999;
  assert.equal(exchange.model.model.nodes[0].x, 0);
  reloaded.model.model.nodes[1].y = 999;
  assert.equal(exchange.model.model.nodes[1].y, 0);
  assert.deepEqual(summarizeExchange(exchange), {
    modelFormat: 'fem-struct-pygo-v1', nodes: 4, elements: 2, springs: 1, constraints: 1,
    loadCases: 3, loadCombinations: 1, units: { length: 'm', force: 'N', time: 's' },
  });
});

test('analysis v2 roundtrips independently of legacy CAD load-case normalization', () => {
  const model = cadAnalysis();
  model.loadCases.push('Q_roof', 'E_custom');
  model.loads.push({ id: 2, type: 'pointLoad', nodeId: 1, loadCase: 'Q_roof', fz: -400 });
  model.loadCombinations.push({ id: 'custom', name: 'custom', factors: { Q_roof: 0.3, E_custom: -1 } });
  model.springs.push({ symbol: 'S-user', kr: 1e7, krY: null, krZ: 'pin', kv: 1000, kt: null });
  model.elements[0].endI = { condition: 'spring', springSymbol: 'S-user' };
  model.extra = { description: 'retained extension' };
  const exchange = createExchange(model, stamp);
  assert.equal(exchange.modelFormat, 'element-modeler-analysis-v2');
  assert.deepEqual(validateExchange(JSON.parse(JSON.stringify(exchange))).model, model);
  assert.equal(summarizeExchange(exchange).springs, 1);
});

test('unknown envelope and source binding fields survive without re-binding', () => {
  const exchange = createExchange(nativeModel(), stamp);
  exchange.annotations = { reviewer: 'A' };
  exchange.sourceCad.label = 'original association';
  const copy = validateExchange(exchange);
  assert.deepEqual(copy, exchange);
  copy.sourceCad.label = 'changed';
  assert.equal(exchange.sourceCad.label, 'original association');
});

test('explicit multi-node and 3D data remain in the declared source axes and units', () => {
  const model = nativeModel();
  model.model.ndm = 3; model.model.ndf = 6;
  model.model.supports[0].fixity = [true, true, true, false, false, false];
  model.model.nodal_masses[0].mass = [10, 10, 10, 0, 0, 0];
  model.model.constraints[0].slave_dof = 6;
  model.model.constraints[0].terms[0].dof = 6;
  model.model.elements.push({ type: 'futureShell', tag: 42, nodes: [1, 101, 2, 102], formulation: 'custom' });
  assert.deepEqual(createExchange(model, stamp).model, model);
});

const nativeInvalid = [
  ['duplicate node', model => model.model.nodes.push({ ...model.model.nodes[0] }), /Duplicate.*nodes/],
  ['unsafe node ID', model => { model.model.nodes[0].tag = 2 ** 53; }, /safe integer/],
  ['duplicate element', model => model.model.elements.push({ ...model.model.elements[0] }), /Duplicate.*elements/],
  ['unknown element node', model => { model.model.elements[0].node_j = 99; }, /Unknown.*node_j/],
  ['string node reference', model => { model.model.elements[0].node_i = '1'; }, /Unknown.*node_i/],
  ['unknown shell node', model => model.model.elements.push({ tag: 5, type: 'shell', nodes: [1, 44] }), /Unknown.*nodes/],
  ['missing connectivity', model => model.model.elements.push({ tag: 5, type: 'unknown' }), /explicit.*connectivity/],
  ['bad coordinates', model => { model.model.nodes[0].x = '0'; }, /finite number/],
  ['invalid dimension', model => { model.model.ndm = 4; }, /ndm.*safe integer/],
  ['invalid DOF count', model => { model.model.ndf = 0; }, /ndf.*safe integer/],
  ['support node', model => { model.model.supports[0].node_tag = 99; }, /Unknown.*supports/],
  ['duplicate support', model => model.model.supports.push({ ...model.model.supports[0] }), /Duplicate.*supports/],
  ['support length', model => { model.model.supports[0].fixity = [true, true]; }, /ndf booleans/],
  ['support type', model => { model.model.supports[0].fixity[1] = 'true'; }, /ndf booleans/],
  ['mass node', model => { model.model.nodal_masses[0].node_tag = 44; }, /Unknown.*nodal_masses/],
  ['duplicate mass', model => model.model.nodal_masses.push({ ...model.model.nodal_masses[0] }), /Duplicate.*nodal_masses/],
  ['mass length', model => { model.model.nodal_masses[0].mass = [10]; }, /ndf values/],
  ['MPC slave node', model => { model.model.constraints[0].slave_node_tag = 44; }, /Unknown.*slave_node_tag/],
  ['MPC slave DOF', model => { model.model.constraints[0].slave_dof = 0; }, /slave_dof.*safe integer/],
  ['MPC master node', model => { model.model.constraints[0].terms[0].node_tag = 44; }, /Unknown.*terms/],
  ['MPC master DOF', model => { model.model.constraints[0].terms[0].dof = 4; }, /terms.dof.*safe integer/],
  ['MPC coefficient', model => { model.model.constraints[0].terms[0].coefficient = null; }, /coefficient.*finite/],
  ['group node', model => model.model.groups.wall.nodes.push(99), /Unknown.*groups.nodes/],
  ['group element', model => model.model.groups.wall.elements.push(99), /Unknown.*groups.elements/],
  ['inactive element', model => model.model.inactive_elements.push(99), /Unknown.*inactive_elements/],
  ['load node', model => { model.load_cases[0].nodal_loads[0].node_tag = 99; }, /Unknown.*nodal_loads/],
  ['load component', model => { model.load_cases[0].nodal_loads[0].fy = '-1000'; }, /nodal_loads.fy.*finite/],
  ['prescribed node', model => { model.load_cases[2].nodal_displacements[0].node_tag = 99; }, /Unknown.*nodal_displacements/],
  ['load element', model => { model.load_cases[0].element_loads[0].element_tag = 99; }, /Unknown.*element_loads/],
  ['uniform load value', model => { model.load_cases[0].element_loads[0].wx = null; }, /element_loads.wx.*finite/],
  ['duplicate case', model => model.load_cases.push({ name: 'G' }), /Duplicate.*load_cases/],
  ['duplicate combination', model => model.load_combinations.push({ name: 'custom design', factors: {} }), /Duplicate.*load_combinations/],
  ['unknown combination case', model => { model.load_combinations[0].factors.Q_unknown = 1; }, /Unknown.*load case/],
  ['combination factor', model => { model.load_combinations[0].factors.G = '1.2'; }, /factors.G.*finite/],
  ['generated topology', model => { model.model.thin_walled_members = [{ name: 'generated' }]; }, /Expand generated/],
  ['missing units', model => { delete model.units; }, /units must be an object/],
];
for (const [name, mutate, pattern] of nativeInvalid) {
  test(`native ${name} is rejected without changing its source`, () => {
    const model = nativeModel(); mutate(model);
    const before = structuredClone(model);
    assert.throws(() => createExchange(model, stamp), pattern);
    assert.deepEqual(model, before);
  });
}

const analysisInvalid = [
  ['duplicate node', model => model.nodes.push({ ...model.nodes[0] }), /Duplicate.*nodes/],
  ['bad node ID', model => { model.nodes[0].id = 1.2; }, /safe integer/],
  ['unknown node', model => { model.elements[0].nodeI = 999; }, /Unknown.*nodeI/],
  ['section reference', model => { model.elements[0].sectionId = 999; }, /Unknown.*sectionId/],
  ['material reference', model => { model.elements[0].material = 'missing'; }, /Unknown.*material/],
  ['spring reference', model => { model.elements[0].endJ = { condition: 'spring', springSymbol: 'missing' }; }, /Unknown.*springSymbol/],
  ['duplicate cases', model => model.loadCases.push('DL'), /Duplicate.*loadCases/],
  ['duplicate combination ID', model => model.loadCombinations.push({ ...model.loadCombinations[0], name: 'other' }), /Duplicate.*loadCombinations.id/],
  ['unknown load case', model => { model.loads[0].loadCase = 'missing'; }, /Unknown.*loadCase/],
  ['unknown target', model => { model.loads[0].nodeId = 999; }, /Unknown.*nodeId/],
  ['unknown member target', model => { model.loads[0].elementId = 999; }, /Unknown.*elementId/],
  ['mass source case', model => { model.massSources.missing = 1; }, /Unknown.*massSources/],
];
for (const [name, mutate, pattern] of analysisInvalid) {
  test(`analysis v2 ${name} is rejected`, () => {
    const model = cadAnalysis(); mutate(model);
    assert.throws(() => createExchange(model, stamp), pattern);
  });
}

test('format/version, declared model type and source hash are strict', () => {
  for (const model of [{ schema_version: 1 }, { schema_version: '2' }, { format: 'element-modeler-analysis', version: 1 }]) {
    assert.throws(() => createExchange(model, stamp), /Unsupported.*format\/version/);
  }
  for (const mutate of [
    value => { value.format = 'unknown'; },
    value => { value.version = 2; },
    value => { value.modelFormat = 'element-modeler-analysis-v2'; },
    value => { value.sourceCad.fingerprintVersion = 'future'; },
    value => { value.sourceCad.fingerprint = 'sha256:123'; },
  ]) {
    const exchange = createExchange(nativeModel(), stamp); mutate(exchange);
    assert.throws(() => validateExchange(exchange), /Unsupported|does not match|fingerprint/);
  }
  assert.throws(() => createExchange(nativeModel(), ''), /fingerprint/);
});

test('non-JSON and non-finite extension values cannot silently change during serialization', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, 1n, () => {}, new Date()]) {
    const model = nativeModel(); model.extension.bad = value;
    assert.throws(() => createExchange(model, stamp), /finite|JSON data/);
  }
  const model = nativeModel(); model.extension.cycle = model;
  assert.throws(() => createExchange(model, stamp), /JSON data/);
});

test('envelope is not accepted as raw solver input', () => {
  const exchange = createExchange(nativeModel(), stamp);
  assert.throws(() => createExchange(exchange, stamp), /Unsupported.*format\/version/);
});
