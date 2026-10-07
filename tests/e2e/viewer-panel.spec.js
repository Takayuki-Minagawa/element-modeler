import { test, expect } from '@playwright/test';
import { AppState } from '../../js/state.js';
import { buildBenchmarkState } from '../../scripts/benchmark-fixture.mjs';
import { installOfflineRoutes } from './offline.mjs';

const pageErrors = new WeakMap();
test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function openViewer(page) {
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-tools .viewer-tools-drag')).toBeVisible();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
}

async function dragPanel(page, dx, dy) {
  const handle = await page.locator('.viewer-tools-drag').boundingBox();
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}

async function panelBounds(page) {
  const panel = await page.locator('#viewer-tools').boundingBox();
  const canvas = await page.locator('#canvas-container').boundingBox();
  return {
    x: panel.x - canvas.x, y: panel.y - canvas.y,
    right: canvas.x + canvas.width - panel.x - panel.width,
    bottom: canvas.y + canvas.height - panel.y - panel.height,
    width: panel.width, height: panel.height,
  };
}

async function expectPanelInside(page) {
  await expect.poll(async () => {
    const box = await panelBounds(page);
    return box.x >= 11 && box.y >= 11 && box.right >= 11 && box.bottom >= 11;
  }).toBe(true);
}

async function viewerSnapshot(page) {
  return page.evaluate(() => {
    const { state, viewer3d: viewer } = window._app;
    const rounded = values => values.map(value => Math.round(value * 1e9) / 1e9);
    return {
      model: state.toJSON(), selectedMember: state.selectedMemberId,
      camera: rounded(viewer.camera.position.toArray()),
      rotation: rounded(viewer.camera.quaternion.toArray()),
      target: rounded(viewer.controls.target.toArray()),
    };
  });
}

test('3D tools move with pointer and keyboard without changing the model or camera, and folding preserves clipping', async ({ page }) => {
  const model = buildBenchmarkState(AppState, 2).toJSON();
  await page.locator('#file-import').setInputFiles({ name: 'panel.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(model.members.length);
  await page.locator('#sel-tool').selectOption('select');
  const memberPoint = await page.evaluate(() => {
    const { state, canvas2d } = window._app;
    const member = state.getMember('M1');
    const a = state.getNode(member.startNodeId), b = state.getNode(member.endNodeId);
    return canvas2d.worldToScreen((a.x + b.x) / 2, (a.y + b.y) / 2);
  });
  await page.locator('#canvas-2d').click({ position: memberPoint });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  await openViewer(page);
  const initial = await panelBounds(page);
  const snapshot = await viewerSnapshot(page);
  await dragPanel(page, -160, 90);
  const moved = await panelBounds(page);
  expect(moved.x).toBeCloseTo(initial.x - 160, 0);
  expect(moved.y).toBeCloseTo(initial.y + 90, 0);
  expect(await viewerSnapshot(page)).toEqual(snapshot);

  const handle = page.locator('.viewer-tools-drag');
  await handle.press('ArrowLeft');
  await handle.press('Shift+ArrowDown');
  const keyed = await panelBounds(page);
  expect(keyed.x).toBeCloseTo(moved.x - 10, 0);
  expect(keyed.y).toBeCloseTo(moved.y + 50, 0);
  await handle.press('Home');
  await expect.poll(async () => Math.round((await panelBounds(page)).right)).toBe(12);
  await expect.poll(async () => Math.round((await panelBounds(page)).y)).toBe(12);
  expect(await viewerSnapshot(page)).toEqual(snapshot);

  const host = page.locator('#viewer-tools');
  await host.locator('select').selectOption('X');
  await host.locator('input[type="range"]').fill('2500');
  await host.locator('input[type="range"]').dispatchEvent('input');
  const clipping = await page.evaluate(() => window._app.viewer3d.clipping);
  const expanded = await panelBounds(page);
  const toggle = host.locator('.viewer-tools-toggle');
  await expect(toggle).toHaveAttribute('aria-controls', 'viewer-tools-content');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  expect((await panelBounds(page)).height).toBeLessThan(expanded.height / 2);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#viewer-tools-content')).toBeVisible();
  await expect(host.locator('select')).toHaveValue('X');
  expect(await page.evaluate(() => window._app.viewer3d.clipping)).toEqual(clipping);
  expect(await viewerSnapshot(page)).toEqual(snapshot);
});

test('a moved 3D panel stays reachable after viewport and sidebar resizing', async ({ page }) => {
  await openViewer(page);
  const canvas = await page.locator('#canvas-container').boundingBox();
  const handle = await page.locator('.viewer-tools-drag').boundingBox();
  await dragPanel(page,
    canvas.x + canvas.width - 5 - handle.x - handle.width / 2,
    canvas.y + canvas.height - 5 - handle.y - handle.height / 2);
  await expectPanelInside(page);
  await expect.poll(async () => Math.round((await panelBounds(page)).bottom)).toBe(12);

  await page.setViewportSize({ width: 1100, height: 700 });
  await expectPanelInside(page);
  const beforeResize = await page.locator('#canvas-container').boundingBox();
  const resizer = await page.locator('#property-resizer').boundingBox();
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizer.x + resizer.width / 2 - 90, resizer.y + resizer.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('#canvas-container').boundingBox()).width).toBeLessThan(beforeResize.width - 50);
  await expectPanelInside(page);
  await page.locator('.viewer-tools-toggle').click();
  await page.locator('.viewer-tools-toggle').click();
  await expectPanelInside(page);
  await expect(page.locator('.viewer-tools-drag')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expectPanelInside(page);
  const corrected = await panelBounds(page);
  await page.reload();
  await openViewer(page);
  expect((await panelBounds(page)).x).toBeCloseTo(corrected.x, 0);
  expect((await panelBounds(page)).y).toBeCloseTo(corrected.y, 0);
});

test('3D panel position and folding survive view switches, language changes and reload', async ({ page }) => {
  await openViewer(page);
  await dragPanel(page, -180, 80);
  await page.locator('.viewer-tools-toggle').click();
  const saved = await panelBounds(page);
  await page.locator('#tab-2d').click();
  await expect(page.locator('#viewer-tools')).toBeHidden();
  await openViewer(page);
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect((await panelBounds(page)).x).toBeCloseTo(saved.x, 0);
  expect((await panelBounds(page)).y).toBeCloseTo(saved.y, 0);

  await page.locator('#btn-settings').click();
  await page.locator('#settings-lang').selectOption('en');
  await page.locator('#btn-settings-close').click();
  await expect(page.locator('.viewer-tools-drag')).toContainText('3D view and export');
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  expect((await panelBounds(page)).x).toBeCloseTo(saved.x, 0);
  expect((await panelBounds(page)).y).toBeCloseTo(saved.y, 0);

  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
  await openViewer(page);
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  expect((await panelBounds(page)).x).toBeCloseTo(saved.x, 0);
  expect((await panelBounds(page)).y).toBeCloseTo(saved.y, 0);
  await page.locator('.viewer-tools-toggle').click();
  await expect(page.locator('#viewer-tools-content')).toBeVisible();
  await expectPanelInside(page);
});
