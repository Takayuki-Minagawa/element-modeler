import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AppState } from '../js/state.js';
import { buildAnalysisModel } from '../js/analysis-export.js';
import { FINGERPRINT_VERSION, modelFingerprint } from '../js/analysis/fingerprint.js';
import { previewToPointLoads } from '../js/analysis/load-distribution.js';
import { initAnalysisWorkbench, previewModelLoad, distributedAnalysisModel, validateReferenceModel } from '../js/analysis/workbench.js';

function lineState() {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(5000, 0);
  state.addMember(a.id, b.id, { levelId: 'L0' });
  state.addLoad('lineLoad', { x1: 0, y1: 0, x2: 5000, y2: 0, value: 1000, loadCase: 'DL' });
  state.addLoad('pointLoad', { x1: 0, y1: 0, fz: 10, loadCase: 'LL' });
  return state;
}
const lineModel = () => buildAnalysisModel(lineState());

test('workbench converts the original load units once and conserves signed vertical load', () => {
  const model = lineModel();
  const preview = previewModelLoad(model, 1, { elementIds: [1], sign: -1 });
  assert.equal(preview.conservation.passed, true);
  assert.equal(preview.targets.reduce((sum, row) => sum + row.force[2], 0), -5000);
  assert.equal(preview.conservation.original.moment[1], 12500000);
  assert.equal(preview.loadCase, 'DL');
  assert.throws(() => previewToPointLoads(preview), /acknowledge/);
});

test('distributed export replaces original load without double counting, preserves other cases and records source model', async () => {
  const model = lineModel();
  const before = structuredClone(model);
  const preview = previewModelLoad(model, 1, { elementIds: [1] });
  const assigned = previewToPointLoads(preview, { acknowledgeLumping: true });
  const output = await distributedAnalysisModel(model, 1, assigned);
  assert.deepEqual(model, before);
  assert.equal(output.meta.sourceModelFingerprint, await modelFingerprint(model));
  assert.deepEqual(output.loads.map(load => load.id), [1, 2, 3]);
  assert.equal(output.loads.filter(load => load.loadCase === 'LL').length, 1);
  assert.equal(output.loads.filter(load => load.type === 'lineLoad').length, 0);
  assert.equal(output.loads.filter(load => load.loadCase === 'DL').reduce((sum, load) => sum + load.fz, 0), -5000);
  assert.equal(await validateReferenceModel(model, output), await modelFingerprint(model));
  output.nodes[0].x = 200;
  await assert.rejects(validateReferenceModel(model, output), /geometry/);
});

test('unsupported load selection and missing export source are rejected', async () => {
  const model = lineModel();
  assert.throws(() => previewModelLoad(model, 2, { elementIds: [1] }), /Only/);
  assert.throws(() => previewModelLoad(model, 1, { elementIds: [1], sign: 0 }), /direction/);
  await assert.rejects(distributedAnalysisModel(model, 404, []), /Missing/);
});

// Exercise the real workbench and panels with DOM event lifecycles. Digests use
// real SHA-256 bytes, with one completion controlled by the test (no sleeps).
class DomNode {
  constructor(tag, doc) {
    this.tag = tag; this.ownerDocument = doc; this.children = []; this.listeners = new Map();
    this.attributes = {}; this.style = {}; this._value = '';
  }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(n => n.textContent).join(''); }
  set value(value) { this._value = String(value); }
  get value() { return this._value || (this.tag === 'select' ? this.children[0]?.value || '' : ''); }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners.set(event, handler); }
  removeEventListener(event, handler) { if (this.listeners.get(event) === handler) this.listeners.delete(event); }
  replaceChildren(...nodes) { this.children = []; this.text = ''; this.append(...nodes); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(n => n !== this); }
  find(predicate) { return [this, ...this.children.flatMap(n => n.find(predicate))].filter(predicate); }
  emit(event) { return this.listeners.get(event)?.(); }
  click() { return this.emit('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
}

function workbench(t) {
  const doc = { createElement: tag => new DomNode(tag, doc), createElementNS: (_ns, tag) => new DomNode(tag, doc),
    createTextNode: text => { const node = new DomNode('#text', doc); node.textContent = text; return node; } };
  doc.body = doc.createElement('body');
  const host = doc.createElement('div'); doc.body.append(host);
  const state = lineState(), downloads = [], downloaded = deferred();
  t.mock.method(URL, 'createObjectURL', blob => { downloads.push(blob); downloaded.resolve(); return `blob:test-${downloads.length}`; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  const api = initAnalysisWorkbench({ state, host });
  const byId = id => doc.body.find(n => n.id === id)[0];
  const open = () => byId('btn-analysis-workbench').click();
  open(); t.after(() => api.dispose());
  const output = doc.body.find(n => n.className === 'analysis-output')[0];
  const status = doc.body.find(n => n.attributes.role === 'status')[0];
  const upload = (id, value) => {
    const input = byId(id);
    input.files = [{ text: typeof value === 'function' ? value : async () => JSON.stringify(value) }];
    return input.emit('change');
  };
  return { state, api, output, status, byId, open, upload, downloads, downloaded: downloaded.promise,
    preview: () => byId('btn-load-preview').click(),
    edit: () => state.updateNode(state.nodes[1].id, { x: 6000 }),
    nonstructuralEdit: () => state.updateNode(state.nodes[1].id, { label: 'Display only' }),
    export: () => { output.find(n => n.tag === 'input')[0].checked = true; output.find(n => n.tag === 'button').at(-1).click(); },
  };
}
const svgCount = ui => ui.output.find(n => n.tag === 'svg').length;
const drain = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function delayDigest(t, index) {
  return delayDigests(t, [index]).get(index);
}
function delayDigests(t, indices) {
  const gates = new Map(indices.map(index => [index, { reached: deferred(), gate: deferred() }]));
  let count = 0;
  t.mock.method(globalThis.crypto.subtle, 'digest', async (_algorithm, bytes) => {
    const digest = Uint8Array.from(createHash('sha256').update(bytes).digest()).buffer;
    const delayed = gates.get(++count);
    if (delayed) { delayed.reached.resolve(); await delayed.gate.promise; }
    return digest;
  });
  t.after(() => { for (const { gate } of gates.values()) gate.resolve(); });
  return new Map([...gates].map(([index, { reached, gate }]) =>
    [index, { reached: reached.promise, release: gate.resolve, reject: gate.reject }]));
}

// Contract-valid UI fixture; solver accuracy is covered by the real result
// fixtures in analysis-results-panel.test.js and the Python solver tests.
async function resultFor(model) {
  return {
    format: 'element-modeler-analysis-result', version: 1, status: 'success',
    fingerprintVersion: FINGERPRINT_VERSION, modelFingerprint: await modelFingerprint(model), loadCase: 'DL',
    units: { translation: 'mm', rotation: 'rad', force: 'N', moment: 'N*mm' },
    coordinates: { verticalAxis: 'z', handedness: 'right' },
    equilibrium: { passed: true, applied: Array(6).fill(0), reactions: Array(6).fill(0),
      residual: Array(6).fill(0), tolerance: Array(6).fill(1e-6) },
    nodes: model.nodes.map(n => ({ id: n.id, position: [n.x, n.y, n.z], displacement: Array(6).fill(0), reaction: Array(6).fill(0) })),
    elements: model.elements.map(e => ({ ...e, localEndForces: Array(12).fill(0) })),
  };
}
async function distributedFor(model) {
  const preview = previewModelLoad(model, 1, { elementIds: [1] });
  return distributedAnalysisModel(model, 1, previewToPointLoads(preview, { acknowledgeLumping: true }));
}

for (const refresh of [false, true]) {
  for (const index of [1, 2]) {
    test(`preview cancels edits during digest ${index}, refresh=${refresh}`, async t => {
      const ui = workbench(t), gate = delayDigest(t, index);
      const pending = ui.preview(); await gate.reached;
      ui.edit(); if (refresh) await ui.api.refresh();
      gate.release(); await pending;
      assert.equal(svgCount(ui), 0);
    });
  }
  for (const index of [1, 2, 3]) {
    test(`result cancels edits during digest ${index}, refresh=${refresh}`, async t => {
      const ui = workbench(t), result = await resultFor(buildAnalysisModel(ui.state));
      const gate = delayDigest(t, index);
      const pending = ui.upload('analysis-result-file', result); await gate.reached;
      ui.edit(); if (refresh) await ui.api.refresh();
      gate.release(); await pending; await ui.api.refresh();
      assert.equal(svgCount(ui), 0);
    });
  }
  for (const index of [1, 2, 3]) {
    test(`reference cancels edits during digest ${index}, refresh=${refresh}`, async t => {
      const ui = workbench(t), reference = await distributedFor(buildAnalysisModel(ui.state));
      const gate = delayDigest(t, index);
      const pending = ui.upload('analysis-reference-file', reference); await gate.reached;
      ui.edit(); if (refresh) await ui.api.refresh();
      gate.release(); await pending;
      assert.equal(ui.status.textContent, '');
      // A rejected reference must not poison a later result for the new model.
      await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
      assert.equal(svgCount(ui), 1);
    });
  }
  for (const index of [1, 2]) {
    test(`export cancels edits during digest ${index}, refresh=${refresh}`, async t => {
      const ui = workbench(t); await ui.preview();
      const gate = delayDigest(t, index);
      ui.export(); await gate.reached;
      ui.edit(); if (refresh) await ui.api.refresh();
      gate.release(); await drain();
      assert.equal(ui.downloads.length, 0);
    });
  }
}

for (const kind of ['preview', 'result', 'reference', 'export']) {
  test(`${kind} cannot finish after reopening the workbench at the final digest`, async t => {
    const ui = workbench(t), model = buildAnalysisModel(ui.state);
    const result = await resultFor(model), reference = await distributedFor(model);
    if (kind === 'export') await ui.preview();
    const gate = delayDigest(t, ['result', 'reference'].includes(kind) ? 3 : 2);
    const pending = kind === 'preview' ? ui.preview() : kind === 'result' ? ui.upload('analysis-result-file', result) :
      kind === 'reference' ? ui.upload('analysis-reference-file', reference) : ui.export();
    await gate.reached;
    ui.open(); gate.release(); await pending; await drain();
    assert.equal(svgCount(ui), 0);
    assert.equal(ui.downloads.length, 0);
    assert.equal(ui.status.textContent, '');
    await ui.upload('analysis-result-file', result);
    assert.equal(svgCount(ui), 1);
  });
}

for (const id of ['analysis-reference-file', 'analysis-result-file']) {
  test(`${id} cancels a delayed file read after a revision without a shown panel`, async t => {
    const ui = workbench(t), model = buildAnalysisModel(ui.state);
    const value = id === 'analysis-reference-file' ? await distributedFor(model) : await resultFor(model);
    const file = deferred();
    const pending = ui.upload(id, () => file.promise);
    ui.edit(); await ui.api.refresh(); file.resolve(JSON.stringify(value)); await pending;
    assert.equal(ui.status.textContent, ''); assert.equal(svgCount(ui), 0);
    await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
    assert.equal(svgCount(ui), 1);
  });
  test(`${id} ignores a superseded file-read error`, async t => {
    const ui = workbench(t), result = await resultFor(buildAnalysisModel(ui.state));
    const file = deferred(), pending = ui.upload(id, () => file.promise);
    await ui.upload('analysis-result-file', result);
    const panel = ui.output.children[0];
    file.reject(new Error('Old file failed')); await pending;
    assert.equal(ui.output.children[0], panel);
    assert.equal(svgCount(ui), 1); assert.equal(ui.status.textContent, '');
  });
}

test('superseded projection rendering cannot append a second panel', async t => {
  const ui = workbench(t), result = await resultFor(buildAnalysisModel(ui.state));
  const gate = delayDigest(t, 3);
  const pending = ui.upload('analysis-result-file', result); await gate.reached;
  ui.byId('analysis-result-scale').value = '10';
  await ui.byId('analysis-result-scale').emit('change');
  const panel = ui.output.children[0];
  gate.release(); await pending;
  assert.equal(svgCount(ui), 1); assert.equal(ui.output.children[0], panel);
  assert.match(ui.output.textContent, /×10/);
});

test('nonstructural revisions preserve a shown result and its distributed reference', async t => {
  const ui = workbench(t), reference = await distributedFor(buildAnalysisModel(ui.state));
  await ui.upload('analysis-reference-file', reference);
  await ui.upload('analysis-result-file', await resultFor(reference));
  const panel = ui.output.children[0];
  ui.nonstructuralEdit(); await ui.api.refresh();
  assert.equal(ui.output.children[0], panel);
  ui.byId('analysis-result-scale').value = '2'; await ui.byId('analysis-result-scale').emit('change');
  assert.equal(svgCount(ui), 1); assert.match(ui.output.textContent, /×2/);
  // Once geometry changes, the old reference must not be used again.
  ui.edit(); await ui.api.refresh();
  assert.equal(svgCount(ui), 0);
  await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
  assert.equal(svgCount(ui), 1);
});

test('nonstructural revisions preserve a preview and allow a fresh export', async t => {
  const ui = workbench(t); await ui.preview();
  const panel = ui.output.children[0];
  ui.nonstructuralEdit(); await ui.api.refresh();
  assert.equal(ui.output.children[0], panel);
  ui.export(); await ui.downloaded;
  assert.equal(ui.downloads.length, 1);
  const model = JSON.parse(await ui.downloads[0].text());
  assert.equal(model.meta.sourceModelFingerprint, await modelFingerprint(buildAnalysisModel(ui.state)));
});

test('a stale refresh completion cannot clear newer results', async t => {
  const ui = workbench(t); await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
  const gate = delayDigest(t, 1);
  ui.edit(); const refreshing = ui.api.refresh(); await gate.reached;
  await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
  const panel = ui.output.children[0];
  gate.release(); await refreshing;
  assert.equal(svgCount(ui), 1); assert.equal(ui.output.children[0], panel);
  assert.equal(ui.status.textContent, '');
});

test('a verified reference without a displayed panel is invalidated by edits', async t => {
  const ui = workbench(t);
  await ui.upload('analysis-reference-file', await distributedFor(buildAnalysisModel(ui.state)));
  ui.edit(); await ui.api.refresh();
  await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
  assert.equal(svgCount(ui), 1); assert.equal(ui.status.textContent, '');
});

for (const completionOrder of [[1, 2], [2, 1]]) {
  for (const structural of [false, true]) {
    test(`overlapping refreshes ${completionOrder} ${structural ? 'discard changed' : 'preserve unchanged'} distributed reference`, async t => {
      const ui = workbench(t), reference = await distributedFor(buildAnalysisModel(ui.state));
      await ui.upload('analysis-reference-file', reference);
      await ui.upload('analysis-result-file', await resultFor(reference));
      const panel = ui.output.children[0], gates = delayDigests(t, [1, 2]);
      ui.nonstructuralEdit(); const first = ui.api.refresh(); await gates.get(1).reached;
      if (structural) ui.edit(); else ui.nonstructuralEdit();
      const second = ui.api.refresh(); await gates.get(2).reached;
      for (const index of completionOrder) {
        gates.get(index).release(); await (index === 1 ? first : second);
      }
      if (structural) {
        assert.equal(svgCount(ui), 0);
        // A later unchanged refresh must not resurrect the discarded candidate.
        ui.nonstructuralEdit(); await ui.api.refresh();
        await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
      } else {
        assert.equal(ui.output.children[0], panel);
        ui.byId('analysis-result-scale').value = '3';
        await ui.byId('analysis-result-scale').emit('change');
        assert.match(ui.output.textContent, /×3/);
      }
      assert.equal(svgCount(ui), 1); assert.equal(ui.status.textContent, '');
    });
  }
}

for (const action of ['replace reference', 'reopen']) {
  test(`${action} discards a quarantined reference despite delayed refresh completion`, async t => {
    const ui = workbench(t), model = buildAnalysisModel(ui.state);
    await ui.upload('analysis-reference-file', await distributedFor(model));
    const gate = delayDigest(t, 1);
    ui.nonstructuralEdit(); const refreshing = ui.api.refresh(); await gate.reached;
    if (action === 'reopen') ui.open(); else await ui.upload('analysis-reference-file', model);
    gate.release(); await refreshing;
    ui.nonstructuralEdit(); await ui.api.refresh();
    await ui.upload('analysis-result-file', await resultFor(buildAnalysisModel(ui.state)));
    assert.equal(svgCount(ui), 1); assert.equal(ui.status.textContent, '');
  });
}

test('dialog close cancels an export waiting for its final digest', async t => {
  const ui = workbench(t); await ui.preview();
  const gate = delayDigest(t, 2);
  ui.export(); await gate.reached;
  ui.output.parent.close();
  gate.release(); await drain();
  assert.equal(ui.downloads.length, 0);
});

test('workbench offers force diagram components, re-renders on change and downloads the member force CSV', async t => {
  const ui = workbench(t), result = await resultFor(buildAnalysisModel(ui.state));
  const component = ui.byId('analysis-result-component');
  assert.deepEqual(component.children.map(option => option.value), ['none', 'N', 'Qy', 'Qz', 'T', 'My', 'Mz']);
  await ui.upload('analysis-result-file', result);
  assert.equal(svgCount(ui), 1);
  assert.equal(ui.output.find(n => n.tag === 'polygon').length, 0);
  component.value = 'N'; await component.emit('change');
  assert.equal(svgCount(ui), 1);
  assert.match(ui.output.textContent, /Force diagram|応力図/);
  ui.output.find(n => n.tag === 'button' && /材端力CSV|member forces CSV/.test(n.textContent))[0].click();
  await ui.downloaded;
  assert.equal(ui.downloads.length, 1);
  assert.equal(ui.downloads[0].type, 'text/csv;charset=utf-8');
  const text = await ui.downloads[0].text(); // Blob.text() strips the UTF-8 BOM prefix
  assert.match(text, /^load_case,element/); assert.match(text, /\r\nDL,1,M1,primary,1,2,5000,/);
});
