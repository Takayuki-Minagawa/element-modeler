import { test as base, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { AppState } from '../../js/state.js';
import { buildAnalysisModel } from '../../js/analysis-export.js';
import { FINGERPRINT_VERSION, modelFingerprint } from '../../js/analysis/fingerprint.js';
import { buildBenchmarkState } from '../../scripts/benchmark-fixture.mjs';
import { installOfflineRoutes } from './offline.mjs';

const test = base.extend({
  page: async ({ page, context, baseURL }, use) => {
    const requests = await installOfflineRoutes(context, baseURL);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto('/');
    await expect.poll(async () => ({ ready: await page.evaluate(() => Boolean(window._app)), errors })).toEqual({ ready: true, errors: [] });
    await expect(page.locator('#canvas-2d')).toBeVisible();
    await page.locator('#tab-3d').click();
    await expect(page.locator('#viewer-3d canvas')).toBeVisible();
    await page.locator('#tab-2d').click();
    await use(page);
    expect(errors, 'uncaught browser errors').toEqual([]);
    expect(requests.blocked, 'unexpected external dependencies').toEqual([]);
    expect(requests.three).toContain('build/three.module.js');
    expect(requests.three).toContain('examples/jsm/controls/OrbitControls.js');
  },
});

async function reviewScreenshot(page, name) {
  if (!process.env.E2E_REVIEW_DIR || test.info().project.name !== 'chromium') return;
  await mkdir(process.env.E2E_REVIEW_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.E2E_REVIEW_DIR, `${name}.png`), fullPage: true });
}

async function importText(page, text, name = 'fixture.json') {
  await page.locator('#file-import').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}
async function importModel(page, model) {
  await importText(page, JSON.stringify(model));
  await expect(page.locator('.app-notice-success')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(model.members.length);
}
async function selectMember(page, id = 'M1') {
  await page.locator('#sel-tool').selectOption('select');
  // Read the live camera transform; selection itself is a real canvas click.
  const point = await page.evaluate(memberId => {
    const { state, canvas2d } = window._app;
    const member = state.getMember(memberId);
    const a = state.getNode(member.startNodeId), b = state.getNode(member.endNodeId);
    return canvas2d.worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
  }, id);
  await page.locator('#canvas-2d').click({ position: point });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe(id);
  await expect(page.locator('#prop-end-x')).toBeVisible();
}
async function modelJSON(page) { return page.evaluate(() => window._app.state.toJSON()); }
async function exportModel(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#menu-file-trigger').click();
  await page.locator('#btn-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.json$/);
  expect(await download.failure()).toBeNull();
  const text = await readFile(await download.path(), 'utf8');
  return { text, model: JSON.parse(text) };
}
async function editEndX(page, value) {
  await page.locator('#prop-end-x').fill(String(value));
  await page.locator('#prop-end-x').press('Tab');
  await expect.poll(() => page.evaluate(() => window._app.state.getNode(window._app.state.getMember('M1').endNodeId).x)).toBe(value);
}
async function undo(page) {
  await page.locator('#tab-2d').focus();
  await page.keyboard.press('Control+z');
}
async function redo(page) {
  await page.locator('#tab-2d').focus();
  await page.keyboard.press('Control+y');
}

test('import, canvas select, edit property, Undo/Redo, export and reimport', async ({ page }) => {
  const model = buildBenchmarkState(AppState, 2).toJSON();
  await importModel(page, model);
  expect(await modelJSON(page)).toEqual(model);
  await selectMember(page);
  await expect(page.locator('#prop-end-x')).toHaveValue('5000');
  await editEndX(page, 4500);
  const edited = await modelJSON(page);
  expect(edited.nodes.find(node => node.id === model.members[0].endNodeId).x).toBe(4500);
  await undo(page);
  await expect.poll(() => modelJSON(page)).toEqual(model);
  await selectMember(page);
  await expect(page.locator('#prop-end-x')).toHaveValue('5000');
  await redo(page);
  await expect.poll(() => modelJSON(page)).toEqual(edited);
  await selectMember(page);
  await expect(page.locator('#prop-end-x')).toHaveValue('4500');
  const exported = await exportModel(page);
  expect(exported.model).toEqual(edited);
  await editEndX(page, 4200);
  await importText(page, exported.text, 'roundtrip.json');
  await expect.poll(() => modelJSON(page)).toEqual(edited);
  await selectMember(page);
  await expect(page.locator('#prop-end-x')).toHaveValue('4500');
  expect((await exportModel(page)).model).toEqual(exported.model);
});

for (const invalid of [
  { name: 'malformed JSON', text: '{not valid JSON' },
  { name: 'unsupported schema', text: JSON.stringify({ schemaVersion: 999999, nodes: [], members: [] }) },
]) {
  test(`${invalid.name} import reports an error and preserves model and redo`, async ({ page }) => {
    const model = buildBenchmarkState(AppState, 2).toJSON();
    await importModel(page, model);
    await selectMember(page);
    await editEndX(page, 4500);
    const edited = await modelJSON(page);
    await undo(page);
    await expect.poll(() => modelJSON(page)).toEqual(model);
    await importText(page, invalid.text, 'invalid.json');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('alert')).not.toHaveText('');
    expect(await modelJSON(page)).toEqual(model);
    expect((await exportModel(page)).model).toEqual(model);
    await redo(page);
    await expect.poll(() => modelJSON(page)).toEqual(edited);
  });
}

test('IndexedDB write failure retains saved generation; retry and reload restore through recovery UI', async ({ page }) => {
  const model = buildBenchmarkState(AppState, 2).toJSON();
  await importModel(page, model);
  await page.locator('#recovery-tools button').click();
  const dialog = page.getByRole('dialog', { name: /Recovery history|復元履歴/ });
  const retry = dialog.getByRole('button', { name: /Save now|今すぐ保存/ });
  const close = dialog.getByRole('button', { name: /Close|閉じる/ });
  await retry.click();
  await expect(page.locator('#recovery-tools [data-status]')).toHaveAttribute('data-status', 'saved');
  await expect(dialog.locator('select option')).toHaveCount(1);
  const savedId = await dialog.locator('select').inputValue();
  await close.click();
  await selectMember(page);
  await editEndX(page, 4500);
  const edited = await modelJSON(page);
  // Fault injection at the native storage boundary, leaving the app/store code
  // intact. The existing database remains readable throughout the failed write.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    window.__restoreIDBAdd = () => { IDBObjectStore.prototype.add = original; };
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'generations') throw new DOMException('E2E simulated quota exhaustion', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await page.locator('#recovery-tools button').click();
  await retry.click();
  await expect(page.locator('#recovery-tools [data-status]')).toHaveAttribute('data-status', 'error');
  await expect(dialog.locator('select option')).toHaveCount(1);
  expect(await dialog.locator('select').inputValue()).toBe(savedId);
  expect(await modelJSON(page)).toEqual(edited);
  await page.evaluate(() => window.__restoreIDBAdd());
  await retry.click();
  await expect(page.locator('#recovery-tools [data-status]')).toHaveAttribute('data-status', 'saved');
  await expect(dialog.locator('select option')).toHaveCount(2);
  await reviewScreenshot(page, 'recovery-dialog');
  await close.click();
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('select option')).toHaveCount(2);
  // Reload does not silently replace a fresh model; user explicitly restores.
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(0);
  await dialog.getByRole('button', { name: /Restore selected|選択した世代を復元/ }).click();
  await expect.poll(() => modelJSON(page)).toEqual(edited);
  await close.click();
  await undo(page);
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(0);
  await redo(page);
  await expect.poll(() => modelJSON(page)).toEqual(edited);
});

function readGLB(buffer) {
  expect(buffer.readUInt32LE(0)).toBe(0x46546c67);
  expect(buffer.readUInt32LE(4)).toBe(2);
  expect(buffer.readUInt32LE(8)).toBe(buffer.length);
  const jsonLength = buffer.readUInt32LE(12);
  expect(buffer.readUInt32LE(16)).toBe(0x4e4f534a);
  const json = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8'));
  const binaryOffset = 20 + jsonLength;
  expect(buffer.readUInt32LE(binaryOffset + 4)).toBe(0x004e4942);
  const binary = buffer.subarray(binaryOffset + 8, binaryOffset + 8 + buffer.readUInt32LE(binaryOffset));
  return { json, binary };
}

function worldPositions({ json, binary }) {
  const points = [];
  function visit(id, parent) {
    const node = json.nodes[id];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(
      new Vector3(...(node.translation || [0, 0, 0])),
      new Quaternion(...(node.rotation || [0, 0, 0, 1])),
      new Vector3(...(node.scale || [1, 1, 1])));
    const matrix = parent.clone().multiply(local);
    if (node.mesh !== undefined) for (const primitive of json.meshes[node.mesh].primitives) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      expect(accessor.type).toBe('VEC3');
      expect(accessor.componentType).toBe(5126);
      const view = json.bufferViews[accessor.bufferView];
      for (let i = 0; i < accessor.count; i++) {
        const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + i * (view.byteStride || 12);
        points.push(new Vector3(binary.readFloatLE(offset), binary.readFloatLE(offset + 4), binary.readFloatLE(offset + 8)).applyMatrix4(matrix));
      }
    }
    for (const child of node.children || []) visit(child, matrix);
  }
  for (const id of json.scenes[json.scene || 0].nodes) visit(id, new Matrix4());
  return points;
}

test('3D clipping, flip, isolation and GLB download preserve model and export clipped geometry in meters', async ({ page }) => {
  const model = buildBenchmarkState(AppState, 2).toJSON();
  await importModel(page, model);
  await selectMember(page);
  await page.locator('#tab-3d').click();
  const host = page.locator('#viewer-tools');
  await expect(host).toBeVisible();
  await host.getByRole('button', { name: /Isolate selection|選択を単独表示/ }).click();
  await host.getByRole('button', { name: /Focus selection|選択へ移動/ }).click();
  await host.locator('select').selectOption('X');
  const slider = host.locator('input[type="range"]');
  await slider.fill('2500');
  await slider.dispatchEvent('input');
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping)).toEqual({ axis: 'X', positionMm: 2500, flipped: false });
  await host.locator('input[type="checkbox"]').check();
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping.flipped)).toBe(true);
  await host.locator('input[type="checkbox"]').uncheck();
  const pending = page.waitForEvent('download');
  await host.getByRole('button', { name: /Export GLB|GLB出力/ }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('element-model.glb');
  expect(await download.failure()).toBeNull();
  const glb = readGLB(await readFile(await download.path()));
  expect(glb.json.asset.version).toBe('2.0');
  expect(glb.json.scenes[0].extras).toMatchObject({ units: 'm', sourceUnits: 'mm', clipping: { axis: 'X', positionMm: 2500, flipped: false, capped: false } });
  const positions = worldPositions(glb);
  expect(positions.length).toBeGreaterThan(10);
  const xs = positions.map(p => p.x);
  expect(Math.max(...xs)).toBeCloseTo(2.5, 4);
  expect(Math.min(...xs)).toBeLessThan(0.1);
  expect(Math.min(...xs)).toBeGreaterThan(-0.2);
  expect(await page.evaluate(() => performance.getEntriesByType('resource').some(entry => entry.name.includes('/examples/jsm/exporters/GLTFExporter.js')))).toBe(true);
  expect(await modelJSON(page)).toEqual(model);
  await reviewScreenshot(page, '3d-clipping-controls');
  await host.locator('select').selectOption('');
  await expect(slider).toBeDisabled();
  await host.getByRole('button', { name: /Clear isolation|単独表示を解除/ }).click();
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping)).toBeNull();
});

test('model diagnostic filters and target button navigate to the offending member', async ({ page }) => {
  const state = buildBenchmarkState(AppState, 2);
  const end = state.getNode(state.members[1].endNodeId);
  state.updateNode(end.id, { x: 6000 }); // second beam has zero length
  state.members[1].levelId = 'L1';
  const model = state.toJSON();
  await importModel(page, model);
  await page.locator('#menu-model-trigger').click();
  await page.locator('#btn-model-check').click();
  await expect(page.locator('#model-check-content [data-diagnostic-target]')).not.toHaveCount(0);
  await page.locator('#diagnostic-severity').selectOption('warning');
  await page.locator('#diagnostic-type').selectOption('member');
  const target = page.locator('[data-diagnostic-target]').filter({ hasText: 'M2' }).first();
  await expect(target).toBeEnabled();
  await target.click();
  await expect.poll(() => page.evaluate(() => ({ id: window._app.state.selectedMemberId, level: window._app.state.activeLevelId }))).toEqual({ id: 'M2', level: 'L1' });
  await expect(page.locator('#prop-end-x')).toHaveValue('6000');
  const point = await page.evaluate(() => window._app.canvas2d.worldToScreen(6000, 0));
  const bounds = await page.locator('#canvas-2d').boundingBox();
  expect(point.x).toBeGreaterThan(0);
  expect(point.x).toBeLessThan(bounds.width);
  expect(point.y).toBeGreaterThan(0);
  expect(point.y).toBeLessThan(bounds.height);
});

for (const kind of ['lineLoad', 'areaLoad']) {
  test(`analysis workbench previews ${kind} and downloads conserved nodal assignments`, async ({ page }) => {
    const state = buildBenchmarkState(AppState, 1);
    const a = state.addNode(0, 4000), b = state.addNode(5000, 4000);
    state.addMember(a.id, b.id, { type: 'beam' });
    state.addLoad(kind, { x1: 0, y1: 0, x2: 5000, y2: kind === 'lineLoad' ? 0 : 4000, value: 1000, loadCase: 'DL' });
    const model = state.toJSON();
    await importModel(page, model);
    await page.locator('#menu-analysis-trigger').click();
    await page.locator('#btn-analysis-workbench').click();
    const dialog = page.locator('dialog.analysis-workbench');
    await expect(dialog).toBeVisible();
    await page.locator('#distribution-load').selectOption('1');
    await page.locator('#distribution-first').selectOption('1');
    await page.locator('#distribution-second').selectOption('2');
    await page.locator('#distribution-axis').selectOption('y');
    await page.locator('#distribution-sign').selectOption('-1');
    await page.locator('#btn-load-preview').click();
    const preview = dialog.locator('.analysis-output section');
    await expect(preview.locator('svg')).toBeVisible();
    await expect(preview.locator('table tr')).toHaveCount(kind === 'lineLoad' ? 3 : 5);
    if (kind === 'areaLoad') await reviewScreenshot(page, 'analysis-workbench');
    const exportButton = preview.getByRole('button', { name: /Export nodal assignments|配分後の節点荷重を出力/ });
    await exportButton.click();
    await expect(preview.getByRole('status')).toContainText(/Accept|同意/);
    await preview.locator('input[type="checkbox"]').check();
    const pending = page.waitForEvent('download');
    await exportButton.click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('distributed-analysis.json');
    const distributed = JSON.parse(await readFile(await download.path(), 'utf8'));
    expect(distributed.format).toBe('element-modeler-analysis');
    expect(distributed.version).toBe(2);
    expect(distributed.loads).toHaveLength(kind === 'lineLoad' ? 2 : 4);
    expect(distributed.loads.every(load => load.type === 'pointLoad' && load.loadCase === 'DL')).toBe(true);
    const expectedForce = kind === 'lineLoad' ? -5000 : -20000;
    expect(distributed.loads.reduce((sum, load) => sum + load.fz, 0)).toBeCloseTo(expectedForce, 7);
    expect(distributed.loads.reduce((sum, load) => sum + load.x1 * load.fz, 0)).toBeCloseTo(expectedForce * 2500, 7);
    expect(distributed.loads.reduce((sum, load) => sum + load.y1 * load.fz, 0)).toBeCloseTo(kind === 'lineLoad' ? 0 : expectedForce * 2000, 7);
    expect(distributed.meta.sourceModelFingerprint).toBe(await modelFingerprint(buildAnalysisModel(state)));
    expect(await modelJSON(page)).toEqual(model);
    await dialog.getByRole('button', { name: /Close|閉じる/, exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}

test('analysis results import, deformation scale, projection, target navigation and stale-file rejection', async ({ page }) => {
  const state = buildBenchmarkState(AppState, 1);
  const model = state.toJSON();
  const analysis = buildAnalysisModel(state);
  // Synthetic complete result for rendering/UI validation; no solver is run.
  const result = {
    format: 'element-modeler-analysis-result', version: 1, status: 'success',
    fingerprintVersion: FINGERPRINT_VERSION, modelFingerprint: await modelFingerprint(analysis),
    units: { translation: 'mm', rotation: 'rad', force: 'N', moment: 'N*mm' },
    coordinates: { verticalAxis: 'z', handedness: 'right' }, loadCase: 'DL',
    equilibrium: { passed: true, applied: [0,0,0,0,0,0], reactions: [0,0,0,0,0,0], residual: [0,0,0,0,0,0], tolerance: [1e-6,1e-6,1e-6,1e-6,1e-6,1e-6] },
    nodes: analysis.nodes.map((node, i) => ({ id: node.id, position: [node.x,node.y,node.z], displacement: [0,0,i ? -10 : 0,0,0,0], reaction: [0,0,0,0,0,0] })),
    elements: analysis.elements.map(element => ({ id: element.id, sourceId: element.sourceId, sourceBranch: element.sourceBranch, nodeI: element.nodeI, nodeJ: element.nodeJ, localEndForces: Array(12).fill(0) })),
  };
  await importModel(page, model);
  await page.locator('#menu-analysis-trigger').click();
  await page.locator('#btn-analysis-workbench').click();
  const dialog = page.locator('dialog.analysis-workbench');
  const uploadResult = value => page.locator('#analysis-result-file').setInputFiles({ name: 'result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await uploadResult(result);
  await expect(dialog.getByRole('img', { name: 'Structural preview XZ' })).toBeVisible();
  const nodeTable = dialog.getByRole('table').filter({ has: page.getByRole('columnheader', { name: /^(Node|節点)$/ }) });
  const memberTable = dialog.getByRole('table').filter({ has: page.getByRole('columnheader', { name: /^(Member \/ branch|部材 \/ 枝番)$/ }) });
  await expect(nodeTable.getByRole('row')).toHaveCount(analysis.nodes.length + 1);
  await expect(memberTable.getByRole('row')).toHaveCount(analysis.elements.length + 1);
  await reviewScreenshot(page, 'analysis-results');
  const deformed = dialog.locator('polyline[stroke="#168ce0"]');
  const before = await deformed.getAttribute('points');
  await page.locator('#analysis-result-scale').fill('100');
  await page.locator('#analysis-result-scale').press('Tab');
  await expect(deformed).not.toHaveAttribute('points', before);
  await page.locator('#analysis-result-plane').selectOption('xy');
  await expect(dialog.getByRole('img', { name: 'Structural preview XY' })).toBeVisible();
  await dialog.locator('.analysis-output').getByRole('button', { name: /M1\// }).click();
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  expect(await modelJSON(page)).toEqual(model);
  await uploadResult({ ...result, modelFingerprint: `sha256:${'0'.repeat(64)}` });
  await expect(dialog.locator('.analysis-output svg')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toContainText(/fingerprint|モデル/);
  await dialog.getByRole('button', { name: /Close|閉じる/, exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test('Undo/Redo keeps the tool selector synchronized after placing a support and switching tools', async ({ page }) => {
  await page.locator('#sel-tool').selectOption('support');
  const point = await page.evaluate(() => window._app.canvas2d.worldToScreen(2000, 1000));
  await page.locator('#canvas-2d').click({ position: point });
  await expect.poll(() => page.evaluate(() => window._app.state.supports.length)).toBe(1);
  await page.locator('#sel-tool').selectOption('select');
  await expect.poll(() => page.evaluate(() => window._app.state.currentTool)).toBe('select');
  await undo(page);
  await expect.poll(() => page.evaluate(() => window._app.state.supports.length)).toBe(0);
  await expect(page.locator('#sel-tool')).toHaveValue('support');
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe(await page.locator('#sel-tool').inputValue());
  await redo(page);
  await expect.poll(() => page.evaluate(() => window._app.state.supports.length)).toBe(1);
  await expect(page.locator('#sel-tool')).toHaveValue('select');
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe(await page.locator('#sel-tool').inputValue());
});

async function dragEndpoint(page, targetX) {
  const { start, end } = await page.evaluate(x => {
    const { state, canvas2d } = window._app;
    const node = state.getNode(state.getMember('M1').endNodeId);
    const rect = canvas2d.canvas.getBoundingClientRect();
    const absolute = point => ({ x: rect.left + point.x, y: rect.top + point.y });
    return { start: absolute(canvas2d.worldToScreen(node.x, node.y)), end: absolute(canvas2d.worldToScreen(x, node.y)) };
  }, targetX);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect.poll(() => page.evaluate(() => window._app.state.getNode(window._app.state.getMember('M1').endNodeId).x)).toBe(targetX);
}

test('physical drag previews never enter recovery; Escape retains unsaved committed edits and mouseup commits', async ({ page }) => {
  await importModel(page, buildBenchmarkState(AppState, 1).toJSON());
  await page.evaluate(() => window._app.autosave.ready);
  await selectMember(page);
  expect(await page.evaluate(() => window._app.autosave.listGenerations())).toEqual([]);
  // First exercise a committed edit with no checkpoint, then repeat with an
  // existing checkpoint. Skipping a provisional save must not mark either clean.
  for (const [committedX, previewX] of [[4500, 6000], [4200, 7000]]) {
    await selectMember(page);
    await editEndX(page, committedX);
    const committed = await modelJSON(page);
    const generations = await page.evaluate(() => window._app.autosave.listGenerations());
    await dragEndpoint(page, previewX);
    expect(await page.evaluate(() => window._app.autosave.saveNow())).toBeNull();
    expect(await page.evaluate(() => window._app.autosave.listGenerations())).toEqual(generations);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect.poll(() => modelJSON(page)).toEqual(committed);
    const saved = await page.evaluate(() => window._app.autosave.saveNow());
    expect(saved).not.toBeNull();
    expect(saved.data).toEqual(committed);
    const after = await page.evaluate(() => window._app.autosave.listGenerations());
    expect(after).toHaveLength(generations.length + 1);
    expect(after[0].data).toEqual(committed);
    expect(await page.evaluate(() => window._app.autosave.getStatus().dirty)).toBe(false);
  }
  await selectMember(page);
  await dragEndpoint(page, 6000);
  await page.mouse.up();
  const committedDrag = await modelJSON(page);
  const savedDrag = await page.evaluate(() => window._app.autosave.saveNow());
  expect(savedDrag).not.toBeNull();
  expect(savedDrag.data).toEqual(committedDrag);
  expect(savedDrag.data.nodes.find(node => node.id === savedDrag.data.members[0].endNodeId).x).toBe(6000);
  await undo(page);
  await expect.poll(() => page.evaluate(() => window._app.state.getNode(window._app.state.getMember('M1').endNodeId).x)).toBe(4200);
});

async function canvasPixels(page) {
  return page.evaluate(async () => {
    const canvas = document.querySelector('#canvas-2d');
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    const hash = await crypto.subtle.digest('SHA-256', pixels);
    return { hash: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join(''), width: canvas.width, height: canvas.height, frames: window._app.canvas2d.stats.frames };
  });
}

test('changing theme redraws the visible 2D canvas immediately without another canvas interaction', async ({ page }) => {
  await importModel(page, buildBenchmarkState(AppState, 2).toJSON());
  await page.locator('#btn-settings').click();
  const before = await canvasPixels(page);
  await page.locator('#settings-theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => (await canvasPixels(page)).frames).toBeGreaterThan(before.frames);
  await expect.poll(async () => (await canvasPixels(page)).hash).not.toBe(before.hash);
  await page.locator('#btn-settings-close').click();
});

test('3D geometry edits refresh clipping range and PNG exports current hidden 2D pixels', async ({ page }) => {
  await importModel(page, buildBenchmarkState(AppState, 1).toJSON());
  await selectMember(page);
  const before = await canvasPixels(page);
  await page.locator('#tab-3d').click();
  await page.locator('#viewer-tools select').selectOption('X');
  const slider = page.locator('#viewer-tools input[type="range"]');
  const previousMax = Number(await slider.getAttribute('max'));
  await editEndX(page, 9000);
  await expect.poll(async () => Number(await slider.getAttribute('max'))).toBeGreaterThan(previousMax);
  expect(Number(await slider.getAttribute('max'))).toBeGreaterThanOrEqual(9000);
  await expect(page.locator('#canvas-2d')).toBeHidden();
  const hidden = await canvasPixels(page);
  const pending = page.waitForEvent('download');
  await page.locator('#menu-file-trigger').click();
  await page.locator('#btn-png-export').click();
  const download = await pending;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  expect(await download.failure()).toBeNull();
  const png = await readFile(await download.path());
  expect([...png.subarray(0, 8)]).toEqual([137,80,78,71,13,10,26,10]);
  const exported = await page.evaluate(async base64 => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    const hash = await crypto.subtle.digest('SHA-256', context.getImageData(0, 0, canvas.width, canvas.height).data);
    return { hash: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join(''), width: canvas.width, height: canvas.height };
  }, png.toString('base64'));
  const afterExport = await canvasPixels(page);
  expect(afterExport.frames).toBeGreaterThan(hidden.frames);
  expect(exported).toEqual({ hash: afterExport.hash, width: afterExport.width, height: afterExport.height });
  expect({ width: exported.width, height: exported.height }).toEqual({ width: before.width, height: before.height });
  expect(exported.hash).not.toBe(before.hash);
  await page.locator('#tab-2d').click();
  await expect.poll(async () => (await canvasPixels(page)).hash).toBe(exported.hash);
});

test('a numeric no-op leaves end-condition and spring controls bound and one Undo restores the edit', async ({ page }) => {
  const state = buildBenchmarkState(AppState, 1);
  state.addSpring({ symbol: 'K_E2E', kx: 1000, ky: 1000, kz: 1000 });
  state.updateMember('M1', { endI: { condition: 'spring', springSymbol: 'K_E2E' } });
  await importModel(page, state.toJSON());
  await selectMember(page);
  const original = await modelJSON(page);
  const historyDepth = await page.evaluate(() => window._app.history.undoStack.length);
  await page.locator('#prop-end-x').fill('5000');
  await page.locator('#prop-end-x').dispatchEvent('change');
  expect(await page.evaluate(() => window._app.history.undoStack.length)).toBe(historyDepth);
  const originalCondition = await page.locator('#prop-endi-condition').inputValue();
  await page.locator('#prop-endi-condition').selectOption('spring');
  const spring = page.locator('#prop-endi-spring');
  await expect(spring).toBeEnabled();
  const choices = await spring.locator('option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
  const beforeSymbol = await spring.inputValue();
  const differentSymbol = choices.find(value => value !== beforeSymbol);
  expect(differentSymbol, 'fixture needs a second spring choice').toBeTruthy();
  await spring.selectOption(differentSymbol);
  await expect.poll(() => page.evaluate(() => window._app.state.getMember('M1').endI.springSymbol)).toBe(differentSymbol);
  await undo(page);
  await expect.poll(() => page.evaluate(() => window._app.state.getMember('M1').endI.springSymbol)).toBe(beforeSymbol);
  if (originalCondition === 'spring') expect(await modelJSON(page)).toEqual(original);
});
