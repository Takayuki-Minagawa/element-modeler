import { test, expect } from '@playwright/test';
import { AppState } from '../../js/state.js';
import { buildAnalysisModel } from '../../js/analysis-export.js';
import { FINGERPRINT_VERSION, modelFingerprint } from '../../js/analysis/fingerprint.js';
import { installOfflineRoutes } from './offline.mjs';

function fixture(zeroLength = false) {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(5000, 0);
  const c = state.addNode(10000, 0), d = state.addNode(15000, 0);
  state.addMember(a.id, b.id);
  state.addMember(c.id, d.id);
  if (zeroLength) state.updateNode(d.id, { x: 10000 });
  return state;
}

async function openModel(page, context, baseURL, state) {
  const requests = await installOfflineRoutes(context, baseURL);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.locator('#file-import').setInputFiles({ name: 'focus.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(state.toJSON())) });
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(2);
  await page.locator('#tab-3d').click();
  await expect.poll(() => page.evaluate(() => window._app.viewer3d?.stats.rebuilds || 0)).toBeGreaterThan(0);
  return () => { expect(errors).toEqual([]); expect(requests.blocked).toEqual([]); };
}

async function hideTarget(page, mode) {
  if (mode === 'isolation') {
    await page.evaluate(() => { window._app.state.select('member', 'M1'); window._app.update(); });
    await page.locator('#viewer-tools').getByRole('button', { name: /Isolate selection|選択を単独表示/ }).click();
  } else {
    await page.locator('#viewer-tools select').selectOption('X');
    await page.locator('#viewer-tools input[type=range]').fill('7500');
    await page.locator('#viewer-tools input[type=range]').dispatchEvent('input');
  }
}

for (const mode of ['isolation', 'clipping', 'zero-length']) {
  test(`diagnostic focus reveals ${mode} target or falls back to framed 2D`, async ({ page, context, baseURL }) => {
    const check = await openModel(page, context, baseURL, fixture(mode === 'zero-length'));
    await hideTarget(page, mode === 'zero-length' ? 'isolation' : mode);
    // Supply a navigation record independently of model validation rules; the
    // target button and application callback are the production UI path.
    await page.evaluate(async () => {
      const { renderDiagnostics } = await import('/js/ui/diagnostics.js');
      renderDiagnostics(window._app.ui, [{ severity: 'warning', message: 'Focus fixture', elementType: 'member', elementId: 'M2' }]);
    });
    await page.locator('#model-check-content [data-diagnostic-target]').click();
    await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M2');
    await expect.poll(() => page.evaluate(() => ({ clip: window._app.viewer3d.clipping, isolation: window._app.viewer3d._isolation }))).toEqual({ clip: null, isolation: null });
    await expect(page.locator('#viewer-tools select')).toHaveValue('');
    if (mode === 'zero-length') {
      await expect(page.locator('#canvas-2d')).toBeVisible();
      const framed = await page.evaluate(() => {
        const { canvas2d: c, viewer3d: v } = window._app;
        return { point: c.worldToScreen(10000, 0), width: c.logicalWidth, height: c.logicalHeight, pending3d: v._frames.pending, active3d: v._frames.active };
      });
      expect(framed.point.x).toBeGreaterThan(0); expect(framed.point.x).toBeLessThan(framed.width);
      expect(framed.point.y).toBeGreaterThan(0); expect(framed.point.y).toBeLessThan(framed.height);
      expect(framed.active3d).toBe(false); expect(framed.pending3d).toBeNull();
    } else {
      await expect(page.locator('#viewer-3d canvas')).toBeVisible();
      const focused = await page.evaluate(() => ({ visible: window._app.viewer3d._visuals.get('member:M2').every(o => o.visible), x: window._app.viewer3d.controls.target.x }));
      expect(focused.visible).toBe(true); expect(focused.x).toBeCloseTo(12.5);
    }
    check();
  });
}

test('analysis result selection uses the same 3D reveal callback', async ({ page, context, baseURL }) => {
  const state = fixture();
  const model = buildAnalysisModel(state);
  const result = {
    format: 'element-modeler-analysis-result', version: 1, status: 'success',
    fingerprintVersion: FINGERPRINT_VERSION, modelFingerprint: await modelFingerprint(model),
    units: { translation: 'mm', rotation: 'rad', force: 'N', moment: 'N*mm' },
    coordinates: { verticalAxis: 'z', handedness: 'right' }, loadCase: 'DL',
    equilibrium: { passed: true, applied: [0,0,0,0,0,0], reactions: [0,0,0,0,0,0], residual: [0,0,0,0,0,0], tolerance: [1e-6,1e-6,1e-6,1e-6,1e-6,1e-6] },
    nodes: model.nodes.map(node => ({ id: node.id, position: [node.x,node.y,node.z], displacement: [0,0,0,0,0,0], reaction: [0,0,0,0,0,0] })),
    elements: model.elements.map(element => ({ id: element.id, sourceId: element.sourceId, sourceBranch: element.sourceBranch, nodeI: element.nodeI, nodeJ: element.nodeJ, localEndForces: Array(12).fill(0) })),
  };
  const check = await openModel(page, context, baseURL, state);
  await hideTarget(page, 'isolation');
  await hideTarget(page, 'clipping');
  await page.locator('#menu-analysis-trigger').click();
  await page.locator('#btn-analysis-workbench').click();
  await page.locator('#analysis-result-file').setInputFiles({ name: 'result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(result)) });
  await page.locator('dialog.analysis-workbench .analysis-output').getByRole('button', { name: /M2\// }).click();
  await expect.poll(() => page.evaluate(() => ({ selected: window._app.state.selectedMemberId, clip: window._app.viewer3d.clipping, isolation: window._app.viewer3d._isolation, x: window._app.viewer3d.controls.target.x }))).toEqual({ selected: 'M2', clip: null, isolation: null, x: 12.5 });
  check();
});
