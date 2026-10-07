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
  await expect(page.locator('#viewer-tools .viewer-tools-title')).toBeVisible();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
}

async function expectDockedPanel(page) {
  await expect(page.locator('#property-panel > #viewer-tools:first-child')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const panel = document.getElementById('viewer-tools').getBoundingClientRect();
    const sidebar = document.getElementById('property-panel').getBoundingClientRect();
    const canvas = document.getElementById('viewer-3d').getBoundingClientRect();
    return panel.width > 0 && canvas.width > 0
      && panel.left >= sidebar.left && panel.right <= sidebar.right + 1
      && panel.left >= canvas.right;
  })).toBe(true);
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

test('3D tools are docked beside the model and folding preserves clipping, isolation and selection', async ({ page }) => {
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
  await expectDockedPanel(page);
  await expect(page.locator('.viewer-tools-drag')).toHaveCount(0);
  expect(await page.locator('.viewer-tools-title').evaluate(el => el.tagName)).not.toBe('BUTTON');
  const snapshot = await viewerSnapshot(page);

  const host = page.locator('#viewer-tools');
  await host.getByRole('button', { name: /Isolate selection|選択を単独表示/ }).click();
  const isolation = await page.evaluate(() => [...window._app.viewer3d._isolation]);
  expect(isolation.length).toBeGreaterThan(0);
  await host.locator('select').selectOption('X');
  await host.locator('input[type="range"]').fill('2500');
  await host.locator('input[type="range"]').dispatchEvent('input');
  await host.locator('input[type="checkbox"]').check();
  const clipping = { axis: 'X', positionMm: 2500, flipped: true };
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping)).toEqual(clipping);
  const expanded = await host.boundingBox();
  const toggle = host.locator('.viewer-tools-toggle');
  await expect(toggle).toHaveAttribute('aria-controls', 'viewer-tools-content');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  expect((await host.boundingBox()).height).toBeLessThan(expanded.height / 2);
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#viewer-tools-content')).toBeVisible();
  await expect(host.locator('select')).toHaveValue('X');
  expect(await page.evaluate(() => window._app.viewer3d.clipping)).toEqual(clipping);
  expect(await page.evaluate(() => [...window._app.viewer3d._isolation])).toEqual(isolation);
  expect(await viewerSnapshot(page)).toEqual(snapshot);
  await expectDockedPanel(page);
  await host.getByRole('button', { name: /Clear isolation|単独表示を解除/ }).click();
  await expect.poll(() => page.evaluate(() => window._app.viewer3d._isolation)).toBeNull();
});

for (const width of [1440, 1024, 768]) {
  test(`3D sidebar stays outside the viewport canvas at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await openViewer(page);
    await expectDockedPanel(page);
    await expect(page.locator('.viewer-tools-title')).toBeInViewport();
    await expect(page.locator('.viewer-tools-toggle')).toBeInViewport();
    const controls = page.locator('#viewer-tools-content select, #viewer-tools-content input, #viewer-tools-content button');
    for (const control of await controls.all()) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const box = await control.boundingBox();
      const canvas = await page.locator('#viewer-3d').boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(canvas.x + canvas.width);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.locator('#tab-2d').click();
    await expect(page.locator('#viewer-tools')).toBeHidden();
    await expect(page.locator('#canvas-2d')).toBeVisible();
  });
}

test('3D tools remain reachable after sidebar resizing and in a short window', async ({ page }) => {
  await openViewer(page);
  const beforeResize = await page.locator('#viewer-3d').boundingBox();
  const resizer = await page.locator('#property-resizer').boundingBox();
  await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + resizer.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizer.x + resizer.width / 2 - 90, resizer.y + resizer.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await page.locator('#viewer-3d').boundingBox()).width).toBeLessThan(beforeResize.width - 50);
  await expectDockedPanel(page);

  await page.setViewportSize({ width: 1024, height: 360 });
  await expectDockedPanel(page);
  const exportButton = page.locator('#viewer-tools').getByRole('button', { name: /Export GLB|GLB出力/ });
  await exportButton.scrollIntoViewIfNeeded();
  await expect(exportButton).toBeInViewport();
  const sidebar = page.locator('#property-panel');
  expect(await sidebar.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
  await sidebar.evaluate(el => { el.scrollTop = 0; });
  await expect(page.locator('.viewer-tools-title')).toBeInViewport();
  await page.locator('.viewer-tools-toggle').click();
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  await page.locator('.viewer-tools-toggle').click();
  await expectDockedPanel(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024);
});

test('old floating coordinates are ignored while folding survives language changes and reload', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('lineframe-viewer-tools-layout', JSON.stringify({
    position: { x: -5000, y: 9000 }, collapsed: true,
  })));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
  await openViewer(page);
  await expectDockedPanel(page);
  await expect(page.locator('.viewer-tools-title')).toBeInViewport();
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  await page.locator('#tab-2d').click();
  await expect(page.locator('#viewer-tools')).toBeHidden();
  await openViewer(page);
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#btn-settings').click();
  await page.locator('#settings-lang').selectOption('en');
  await page.locator('#btn-settings-close').click();
  await expect(page.locator('.viewer-tools-title')).toContainText('3D view and export');
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expectDockedPanel(page);

  await page.locator('.viewer-tools-toggle').click();
  await expect(page.locator('#viewer-tools-content')).toBeVisible();
  await page.locator('.viewer-tools-toggle').click();
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
  await openViewer(page);
  await expect(page.locator('.viewer-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#viewer-tools-content')).toBeHidden();
  await expectDockedPanel(page);
});

test('entering 3D opens the right sidebar and users can close it while staying in 3D', async ({ page }) => {
  await page.locator('#btn-toggle-property').click();
  await expect(page.locator('body')).toHaveClass(/property-collapsed/);
  await openViewer(page);
  await expect(page.locator('body')).not.toHaveClass(/property-collapsed/);
  await expectDockedPanel(page);
  const openWidth = (await page.locator('#viewer-3d').boundingBox()).width;

  await page.locator('#btn-toggle-property').click();
  await expect(page.locator('#viewer-tools')).toBeHidden();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await expect.poll(async () => (await page.locator('#viewer-3d').boundingBox()).width).toBeGreaterThan(openWidth + 100);
  await page.setViewportSize({ width: 1280, height: 768 });
  await expect(page.locator('body')).toHaveClass(/property-collapsed/);
  await page.locator('#tab-2d').click();
  await expect(page.locator('#viewer-tools')).toBeHidden();
  await openViewer(page);
  await expect(page.locator('body')).not.toHaveClass(/property-collapsed/);
  await expectDockedPanel(page);
});
