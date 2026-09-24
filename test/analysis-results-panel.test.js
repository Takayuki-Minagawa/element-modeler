import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { modelFingerprint } from '../js/analysis/fingerprint.js';
import { FORCE_COMPONENTS, buildMemberForceCSV, buildResultView, memberInternalForces, validateAnalysisResult } from '../js/analysis/results.js';
import { forceDiagramShapes, isSignificantComponent, mountResultsPanel, mountLoadPreview } from '../js/analysis/panels.js';
import { previewLineLoad } from '../js/analysis/load-distribution.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/analysis/${name}.json`, import.meta.url)));
const model = () => fixture('rigid-cantilever');
const result = () => fixture('rigid-cantilever-result');

test('real OpenSees fixture fingerprint and exact Hermite cantilever deflection curve', async () => {
  const m = model(), r = result();
  assert.equal(await modelFingerprint(m), r.modelFingerprint);
  const view = await buildResultView(m, r, { scale: 10, segments: 10 });
  const E = 205000, I = m.sections[0].Iy, L = 3000;
  view.members[0].deformed.forEach(([x, _y, z], index) => {
    assert.equal(x, index*300);
    const expected = 10*-1000*x*x*(3*L-x)/(6*E*I);
    assert.ok(Math.abs(z-expected) < 1e-10);
  });
  assert.equal(view.members[0].sourceId, 'DEMO-B1');
  assert.ok(Math.abs(view.reactions[0].reaction[2]-1000) < 1e-8);
});

test('result import rejects stale topology, identity, invalid numerics, equilibrium and units', async () => {
  const mutations = [r => { r.nodes.pop(); }, r => { r.nodes[0].displacement[0] = NaN; },
    r => { r.elements[0].sourceBranch = 'cross'; }, r => { r.elements[0].sourceId = 'wrong'; },
    r => { r.elements[0].localEndForces.pop(); }, r => { r.equilibrium.passed = false; },
    r => { r.equilibrium.residual[0] = 100; }, r => { r.units.translation = 'm'; },
    r => { r.nodes[0].position[0] = 1; }, r => { r.status = 'failed'; }];
  for (const mutate of mutations) {
    const r = result(); mutate(r);
    await assert.rejects(validateAnalysisResult(model(), r));
  }
  const m = model(); m.loads[0].fz = -1001;
  await assert.rejects(validateAnalysisResult(m, result()), /Stale/);
});

test('metadata timestamp/generator do not invalidate results, physical properties and branch edits do', async () => {
  const m = model(), r = result();
  m.meta.generatedAt = 'tomorrow'; m.meta.generator = { appVersion: 'next' };
  await validateAnalysisResult(m, r);
  m.sections[0].Iy += 1;
  await assert.rejects(validateAnalysisResult(m, r), /Stale/);
});

// Minimal DOM with real event lifecycles; no source-string assertions.
class DomNode {
  constructor(tag, doc) { this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map(); this.attributes = {}; this.style = {}; }
  set textContent(text) { this.text = String(text); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(n => n.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  removeEventListener(event, handler) { if (this.listeners.get(event) === handler) this.listeners.delete(event); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
  find(tag) { return [this, ...this.children.flatMap(n => n.find(tag))].filter(n => n.tag === tag); }
}
function container() {
  const doc = { createElement: tag => new DomNode(tag, doc), createElementNS: (_ns, tag) => new DomNode(tag, doc),
    createTextNode: text => { const node = new DomNode('#text', doc); node.textContent = text; return node; } };
  return doc.createElement('div');
}

test('Japanese result panel renders SVG and reactions, selects source identity, and invalidates/disposes', async () => {
  const root = container(), selected = [];
  const panel = await mountResultsPanel(root, model(), result(), { language: 'ja', onSelect: id => selected.push(id) });
  assert.match(root.textContent, /線形静的解析結果/);
  assert.equal(root.find('svg').length, 1);
  assert.match(root.find('table')[0].textContent, /1000/);
  root.find('button')[0].listeners.get('click')();
  assert.deepEqual(selected, [{ elementId: 1, sourceId: 'DEMO-B1', sourceBranch: 'primary' }]);
  panel.invalidate();
  assert.equal(root.find('svg').length, 0);
  assert.match(root.textContent, /モデルが変更/);
  panel.dispose(); assert.equal(root.children.length, 0);
});

test('Japanese load panel requires explicit lumping acceptance and emits converter-compatible point loads', () => {
  const root = container(), outputs = [];
  const preview = previewLineLoad(model(), { elementId: 1, start: [0, 0, 0], end: [3000, 0, 0], intensity: [0, 0, -1] });
  const panel = mountLoadPreview(root, preview, { language: 'ja', onExport: loads => outputs.push(loads) });
  assert.match(root.textContent, /荷重配分プレビュー/);
  const button = root.find('button').find(n => n.textContent === '配分後の節点荷重を出力');
  button.listeners.get('click')(); assert.equal(outputs.length, 0);
  root.find('input')[0].checked = true;
  button.listeners.get('click')(); assert.equal(outputs[0][1].fz, -1500);
  panel.dispose(); assert.equal(root.children.length, 0);
});

test('SVG engineering projection uses one physical scale in both directions', () => {
  const m = model(); m.nodes[1].y = 3000;
  const root = container();
  const preview = previewLineLoad(m, { elementId: 1, start: [0, 0, 0], end: [3000, 3000, 0], intensity: [0, 0, -1] });
  mountLoadPreview(root, preview);
  const [[x0, y0], [x1, y1]] = root.find('polyline')[0].attributes.points.split(' ').map(p => p.split(',').map(Number));
  assert.equal(Math.abs(x1-x0), Math.abs(y1-y0));
});

test('section forces follow the cantilever solution and agree with the J-end forces', async () => {
  const view = await buildResultView(model(), result(), { segments: 2 });
  const [member] = view.members;
  const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a-b) < tolerance, `${a} vs ${b}`);
  near(member.forces.My[0], 3000000); near(member.forces.My[1], 0);
  near(member.forces.Qz[0], -1000); near(member.forces.Qz[1], -1000);
  for (const c of ['N', 'Qy', 'T', 'Mz']) assert.deepEqual(member.forces[c], [0, 0]);
  // The section force at the J end equals the force node J applies to the element.
  FORCE_COMPONENTS.forEach((c, index) => near(member.forces[c][1], member.endForces[6+index]));
  assert.deepEqual(member.axes.x, [1, 0, 0]); assert.equal(member.nodeI, 1); assert.equal(member.nodeJ, 2);
  near(view.extremes.My, 3000000); near(view.extremes.Qz, 1000); assert.equal(view.extremes.N, 0);
  assert.throws(() => memberInternalForces([1, 2, 3], 100), /12 finite/);
  assert.throws(() => memberInternalForces(Array(12).fill(0), 0), /positive/);
  const inclined = memberInternalForces([-10, 20, 30, -40, 50, -60, 10, -20, -30, 40, 0, 0], 2000);
  assert.deepEqual(inclined.N, [10, 10]); assert.deepEqual(inclined.Qy, [-20, -20]); assert.deepEqual(inclined.T, [40, 40]);
  assert.deepEqual(inclined.My, [-50, -50-2000*30]); assert.deepEqual(inclined.Mz, [60, 60+2000*20]);
  assert.ok(!Object.is(inclined.N[0], -0));
});

test('member force CSV lists both ends per element with units in the header', async () => {
  const csv = buildMemberForceCSV(await buildResultView(model(), result()));
  const [header, row, tail] = csv.split('\r\n');
  assert.equal(header, 'load_case,element,source_id,source_branch,node_i,node_j,length_mm,' +
    'N_i_N,Qy_i_N,Qz_i_N,T_i_Nmm,My_i_Nmm,Mz_i_Nmm,N_j_N,Qy_j_N,Qz_j_N,T_j_Nmm,My_j_Nmm,Mz_j_Nmm');
  const cells = row.split(',');
  assert.deepEqual(cells.slice(0, 7), ['LL', '1', 'DEMO-B1', 'primary', '1', '2', '3000']);
  assert.equal(Number(cells[9]), -1000); assert.equal(Number(cells[11]), 3000000);
  assert.ok(Math.abs(Number(cells[16])) < 1e-6); assert.equal(tail, '');
});

test('force diagram draws ordinates on the tension side and scales to the model extent', async () => {
  const view = await buildResultView(model(), result());
  const [shape] = forceDiagramShapes(view, 'My');
  assert.equal(shape.points.length, 4);
  // Hogging moment at the fixed end is positive and drawn toward local +z (above the beam).
  assert.equal(shape.points[1][2], 0.15*3000); assert.ok(Math.abs(shape.points[2][2]) < 1e-6);
  assert.deepEqual(shape.points[0], [0, 0, 0]); assert.deepEqual(shape.points[3], [3000, 0, 0]);
  assert.match(shape.label, /My: 3000000 → /);
  assert.deepEqual(forceDiagramShapes(view, 'N'), []);
  const [shear] = forceDiagramShapes(view, 'Qz');
  assert.equal(shear.points[1][2], -0.15*3000); assert.equal(shear.points[2][2], -0.15*3000);
  // +Mz has tension at local -y, so a positive Mz ordinate points toward -y.
  view.members[0].forces.Mz = [2000000, 0]; view.extremes.Mz = 2000000;
  const [mz] = forceDiagramShapes(view, 'Mz');
  assert.equal(mz.points[1][1], -0.15*3000); assert.equal(mz.points[1][2], 0);
  view.members[0].forces.Qy = [-500, -500]; view.extremes.Qy = 500;
  assert.equal(forceDiagramShapes(view, 'Qy')[0].points[1][1], -0.15*3000);
});

test('solver round-off components are reported as noise instead of being drawn at full size', async () => {
  const view = await buildResultView(model(), result());
  // The fixture carries My_j = 2.3e-10 and the derived Mz/T are exactly zero.
  assert.equal(isSignificantComponent(view.extremes, 'My'), true);
  assert.equal(isSignificantComponent({ N: 0, Qy: 0, Qz: 1000, T: 2e-10, My: 3e6, Mz: 1e-9 }, 'T'), false);
  assert.equal(isSignificantComponent({ N: 0, Qy: 0, Qz: 1000, T: 2e-10, My: 3e6, Mz: 1e-9 }, 'Mz'), false);
  assert.equal(isSignificantComponent({ N: 5e-7, Qy: 0, Qz: 0, T: 0, My: 0, Mz: 0 }, 'N'), false);
  assert.equal(isSignificantComponent({ N: 0, Qy: 0, Qz: 1000, T: 0, My: 3e6, Mz: 10 }, 'Mz'), true);
  view.extremes.T = 2e-10; view.members[0].forces.T = [2e-10, 2e-10];
  assert.deepEqual(forceDiagramShapes(view, 'T'), []);
  const root = container();
  await mountResultsPanel(root, model(), result(), { language: 'en', component: 'T' });
  assert.equal(root.find('polygon').length, 0);
  assert.match(root.textContent, /Diagram: T \[N·mm\]; max \|value\| 0\. Values are numerical noise/);
});

test('result panel renders the chosen diagram, the section force table and exports CSV', async () => {
  const root = container(), exported = [];
  const panel = await mountResultsPanel(root, model(), result(), { language: 'ja', component: 'My', onExportForces: (csv, loadCase) => exported.push([csv, loadCase]) });
  assert.equal(root.find('polygon').length, 1);
  assert.match(root.find('polygon')[0].attributes.class, /force-diagram/);
  assert.match(root.textContent, /応力図: My \[N·mm\]; 最大絶対値 3000000/);
  assert.match(root.textContent, /断面力（I端 → J端）/);
  const forceTable = root.find('table')[1];
  assert.match(forceTable.textContent, /DEMO-B1\/primary \(1\)/);
  assert.match(forceTable.textContent, /3\.00000e\+6/);
  const button = root.find('button').find(n => n.textContent === '材端力CSVを出力');
  button.listeners.get('click')();
  assert.equal(exported.length, 1); assert.equal(exported[0][1], 'LL'); assert.match(exported[0][0], /^load_case,element/);
  assert.match(root.textContent, /材端力CSVを出力しました/);
  panel.dispose();
  const plain = container();
  await mountResultsPanel(plain, model(), result(), { language: 'en' });
  assert.equal(plain.find('polygon').length, 0);
  assert.equal(plain.find('button').some(n => /Export member forces/.test(n.textContent)), false);
  await assert.rejects(mountResultsPanel(container(), model(), result(), { component: 'Mx' }), /Unknown force component/);
});
