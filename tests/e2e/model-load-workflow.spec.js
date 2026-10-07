import { test, expect } from '@playwright/test';
import { AppState } from '../../js/state.js';
import { installOfflineRoutes } from './offline.mjs';

const errors = new WeakMap();
test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const list = [];
  errors.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window._app));
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

function fixture(offset = 0) {
  const state = new AppState();
  const a = state.addNode(offset, offset), b = state.addNode(offset + 3000, offset);
  state.addMember(a.id, b.id);
  return state.toJSON();
}
const upload = (page, data) => page.locator('#file-import').setInputFiles({
  name: 'load-workflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
});
async function startPlacement(page) {
  await page.locator('#coordinate-input > summary').click();
  await page.locator('#coordinate-x').fill('1000');
  await page.locator('#coordinate-y').fill('1000');
  await page.locator('#coordinate-form button[type="submit"]').click();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 1');
}

test('successful CAD load discards unfinished input and starts the next beam with a fresh point', async ({ page }) => {
  await startPlacement(page);
  await upload(page, fixture());
  await expect(page.locator('#model-summary')).toContainText('線材 1');
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  await page.locator('#coordinate-x').fill('2000');
  await page.locator('#coordinate-form button[type="submit"]').click();
  await expect(page.locator('#model-summary')).toContainText('線材 1');
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 1');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#model-summary')).toContainText('線材 0');
});

test('rejected CAD load preserves unfinished input, camera and history', async ({ page }) => {
  await startPlacement(page);
  const before = await page.evaluate(() => ({ model: window._app.state.toJSON(), camera: window._app.canvas2d.camera,
    undo: window._app.history.undoStack.length, redo: window._app.history.redoStack.length }));
  await upload(page, { schemaVersion: 999 });
  await expect(page.locator('.app-notice')).toContainText('読込');
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 1');
  expect(await page.evaluate(() => ({ model: window._app.state.toJSON(), camera: window._app.canvas2d.camera,
    undo: window._app.history.undoStack.length, redo: window._app.history.redoStack.length }))).toEqual(before);
});

test('loading a remote-coordinate model immediately frames its visible plan geometry', async ({ page }) => {
  await upload(page, fixture(900000));
  await expect(page.locator('#model-summary')).toContainText('線材 1');
  const view = await page.evaluate(() => {
    const { state, canvas2d: c } = window._app;
    return { points: state.nodes.map(n => c.worldToScreen(n.x, n.y)), width: c.logicalWidth, height: c.logicalHeight };
  });
  for (const point of view.points) {
    expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(view.width);
    expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(view.height);
  }
});

test('sample load clears unfinished placement through the same model replacement flow', async ({ page }) => {
  await startPlacement(page);
  await page.locator('#menu-help-trigger').click();
  await page.locator('#btn-sample-frame').click();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBeGreaterThan(0);
});

test('new grid generation clears unfinished placement and remains a single undo step', async ({ page }) => {
  await startPlacement(page);
  await page.locator('#menu-model-trigger').click();
  await page.locator('#btn-grid-frame').click();
  await page.locator('#grid-frame-spans-x').fill('3000');
  await page.locator('#grid-frame-spans-y').fill('3000');
  await page.locator('#grid-frame-form button[type="submit"]').click();
  await expect(page.locator('#grid-frame-modal')).toBeHidden();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#model-summary')).toContainText('線材 0');
});

test('model replacement clears prior 3D isolation and clipping and reframes the new model', async ({ page }) => {
  await upload(page, fixture());
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await page.evaluate(() => { window._app.state.select('member', 'M1'); window._app.update(); });
  await page.locator('#viewer-tools').getByRole('button', { name: '選択を単独表示', exact: true }).click();
  await page.locator('#viewer-tools select').selectOption('X');
  await upload(page, fixture(900000));
  await expect.poll(() => page.evaluate(() => ({ clip: window._app.viewer3d.clipping,
    isolated: window._app.viewer3d._isolation !== null, targetX: window._app.viewer3d.controls.target.x })))
    .toEqual({ clip: null, isolated: false, targetX: 901.5 });
  await expect(page.locator('#viewer-tools select')).toHaveValue('');
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
});

test('recovery clears an unfinished placement without creating a separate undo step', async ({ page }) => {
  await upload(page, fixture());
  await page.evaluate(async () => { await window._app.autosave.ready; await window._app.autosave.saveNow(); });
  await startPlacement(page);
  const undoBefore = await page.evaluate(() => window._app.history.undoStack.length);
  await page.locator('#menu-file-trigger').click();
  await page.locator('[data-recovery-open]').click();
  const dialog = page.getByRole('dialog', { name: /復元履歴/ });
  await dialog.getByRole('button', { name: '選択した世代を復元', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('選択した世代を復元しました');
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  expect(await page.evaluate(() => window._app.history.undoStack.length)).toBe(undoBefore + 1);
});

test('model imported in 3D fits the resized plan viewport when returning to 2D', async ({ page }) => {
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 700 });
  await upload(page, fixture(900000));
  await expect(page.locator('#model-summary')).toContainText('線材 1');
  await page.locator('#tab-2d').click();
  const view = await page.evaluate(() => {
    const { state, canvas2d: c } = window._app;
    return { points: state.nodes.map(n => c.worldToScreen(n.x, n.y)), width: c.logicalWidth, height: c.logicalHeight };
  });
  for (const point of view.points) {
    expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(view.width);
    expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(view.height);
  }
});

test('DXF load and clear are reversible through the visible Undo and Redo buttons', async ({ page }) => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '10', '900000', '20', '0',
    '11', '903000', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  await page.locator('#file-underlay-import').setInputFiles({ name: 'reference.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await expect.poll(() => page.evaluate(() => window._app.state.underlay?.name)).toBe('reference.dxf');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect(await page.evaluate(() => window._app.state.underlay)).toBeNull();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window._app.state.underlay?.name)).toBe('reference.dxf');
  await page.locator('#menu-file-trigger').click();
  await page.locator('#btn-underlay-clear').click();
  expect(await page.evaluate(() => window._app.state.underlay)).toBeNull();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window._app.state.underlay?.name)).toBe('reference.dxf');
});

for (const view of ['2d', '3d']) {
  test(`undo and redo of a distant model replacement keep the restored model visible in ${view}`, async ({ page }) => {
    await upload(page, fixture());
    if (view === '3d') {
      await page.locator('#tab-3d').click();
      await expect(page.locator('#viewer-3d canvas')).toBeVisible();
    }
    await upload(page, fixture(900000));
    for (const [button, offset] of [['元に戻す', 0], ['やり直す', 900000], ['元に戻す', 0]]) {
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect.poll(() => page.evaluate(() => window._app.state.nodes[0].x)).toBe(offset);
      if (view === '3d') {
        await expect.poll(() => page.evaluate(() => window._app.viewer3d.controls.target.x)).toBe(offset / 1000 + 1.5);
      } else {
        const positions = await page.evaluate(() => {
          const { state, canvas2d: c } = window._app;
          return { points: state.nodes.map(n => c.worldToScreen(n.x, n.y)), width: c.logicalWidth, height: c.logicalHeight };
        });
        for (const point of positions.points) {
          expect(point.x).toBeGreaterThan(0); expect(point.x).toBeLessThan(positions.width);
          expect(point.y).toBeGreaterThan(0); expect(point.y).toBeLessThan(positions.height);
        }
      }
    }
  });
}

test('ordinary edit undo preserves the camera instead of fitting the model', async ({ page }) => {
  await upload(page, fixture());
  await startPlacement(page);
  await page.locator('#coordinate-x').fill('2000');
  await page.locator('#coordinate-form button[type="submit"]').click();
  await expect(page.locator('#model-summary')).toContainText('線材 2');
  await page.evaluate(() => { window._app.canvas2d.pan(120, -80); window._app.update(); });
  const camera = await page.evaluate(() => window._app.canvas2d.camera);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#model-summary')).toContainText('線材 1');
  expect(await page.evaluate(() => window._app.canvas2d.camera)).toEqual(camera);
});
