import { test, expect } from '@playwright/test';
import { installOfflineRoutes } from './offline.mjs';

test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});

test('fit shows a 300 m model and the next wheel step preserves the cursor anchor', async ({ page }) => {
  await page.evaluate(() => {
    const { state, update } = window._app;
    const a = state.addNode(100000, 200000), b = state.addNode(400000, 200000);
    state.addMember(a.id, b.id, { levelId: 'L0' });
    update();
  });
  const before = await page.evaluate(() => window._app.state.toJSON());
  await page.locator('#btn-plan-fit').click();
  const fit = await page.evaluate(() => {
    const view = window._app.canvas2d;
    return { first: view.worldToScreen(100000, 200000), last: view.worldToScreen(400000, 200000),
      width: view.logicalWidth, height: view.logicalHeight, scale: view.camera.scale,
      anchor: view.screenToWorld(180, 120) };
  });
  for (const point of [fit.first, fit.last]) {
    expect(point.x).toBeGreaterThan(0);
    expect(point.x).toBeLessThan(fit.width);
    expect(point.y).toBeGreaterThan(0);
    expect(point.y).toBeLessThan(fit.height);
  }
  expect(fit.scale).toBeLessThan(0.005);
  const box = await page.locator('#canvas-2d').boundingBox();
  await page.mouse.move(box.x + 180, box.y + 120);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => page.evaluate(() => window._app.canvas2d.camera.scale)).toBeCloseTo(fit.scale * 1.1, 10);
  const after = await page.evaluate(() => ({ anchor: window._app.canvas2d.screenToWorld(180, 120),
    model: window._app.state.toJSON() }));
  expect(after.anchor.x).toBeCloseTo(fit.anchor.x, 5);
  expect(after.anchor.y).toBeCloseTo(fit.anchor.y, 5);
  expect(after.model).toEqual(before);
});

test('fit frames an offscreen DXF underlay and excludes it when hidden', async ({ page }) => {
  await page.evaluate(() => {
    const { state, update } = window._app;
    state.setUnderlay({ name: 'survey.dxf', entities: [
      { type: 'line', x1: 100000, y1: 200000, x2: 400000, y2: 200000 },
      { type: 'circle', cx: 200000, cy: 210000, r: 5000 },
    ] });
    update();
  });
  await page.locator('#btn-plan-fit').click();
  const fit = await page.evaluate(() => {
    const view = window._app.canvas2d;
    return { first: view.worldToScreen(100000, 200000), last: view.worldToScreen(400000, 215000),
      width: view.logicalWidth, height: view.logicalHeight };
  });
  expect(fit.first.x).toBeGreaterThan(0);
  expect(fit.first.y).toBeLessThan(fit.height);
  expect(fit.last.x).toBeLessThan(fit.width);
  expect(fit.last.y).toBeGreaterThan(0);
  await page.evaluate(() => { window._app.state.updateSetting('showUnderlay', false); window._app.update(); });
  await page.locator('#btn-plan-fit').click();
  const hidden = await page.evaluate(() => {
    const view = window._app.canvas2d;
    return { origin: view.worldToScreen(0, 0), width: view.logicalWidth, height: view.logicalHeight };
  });
  expect(hidden.origin.x).toBe(hidden.width / 2);
  expect(hidden.origin.y).toBe(hidden.height / 2);
});
