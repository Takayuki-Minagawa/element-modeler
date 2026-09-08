import { test, expect } from '@playwright/test';
import { installOfflineRoutes } from './offline.mjs';

const browserErrors = new WeakMap();
test.afterEach(async ({ page }) => expect(browserErrors.get(page) || []).toEqual([]));

test.beforeEach(async ({ page, context, baseURL }) => {
  const errors = [];
  browserErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await installOfflineRoutes(context, baseURL);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});
async function clickPoint(page, x, y) {
  const position = await page.evaluate(([x, y]) => window._app.canvas2d.worldToScreen(x, y), [x, y]);
  await page.locator('#canvas-2d').click({ position });
}
test('modified shortcuts and IME do not change the placement tool', async ({ page }) => {
  await page.locator('#canvas-2d').focus();
  await page.locator('#canvas-2d').dispatchEvent('keydown', { key: 's', ctrlKey: true });
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe('member');
  await page.locator('#canvas-2d').dispatchEvent('keydown', { key: 's', isComposing: true });
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe('member');
});
test('keyboard tool selection returns to plan from 3D', async ({ page }) => {
  await page.locator('[data-draw-tool="select"]').click();
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await page.keyboard.press('m');
  await expect(page.locator('#canvas-2d')).toBeVisible({ timeout: 1500 });
});
test('keyboard Undo discards an unfinished beam like the Undo button', async ({ page }) => {
  await clickPoint(page, 0, 0);
  await clickPoint(page, 3000, 0);
  await clickPoint(page, 0, 2000);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window._app.state.members.length)).toBe(0);
  await clickPoint(page, 3000, 2000);
  expect(await page.evaluate(() => window._app.state.members.length)).toBe(0);
});
test('restored load type matches the actual placement mode', async ({ page }) => {
  await page.locator('[data-draw-tool="load"]').click();
  await page.locator('#sel-load-type').selectOption('pointLoad');
  await clickPoint(page, 0, 0);
  await page.locator('#sel-load-type').selectOption('lineLoad');
  await page.locator('#canvas-2d').focus();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window._app.state.loadDraftType)).toBe('pointLoad');
  await expect(page.locator('#sel-load-type')).toHaveValue('pointLoad', { timeout: 1500 });
});
test('language changes preserve the chosen inspector tab', async ({ page }) => {
  await page.locator('#menu-model-trigger').click();
  await page.locator('#btn-model-check').click();
  await page.locator('#inspector-quantities-tab').click();
  await page.locator('#btn-settings').click();
  await page.locator('#settings-lang').selectOption('en');
  await page.locator('#btn-settings-close').click();
  await expect(page.locator('#inspector-quantities')).toBeVisible({ timeout: 1500 });
  await expect(page.locator('#tab-2d')).toHaveText('Plan Input');
});

test('display settings are grouped and explain hidden placement without changing geometry', async ({ page }) => {
  const before = await page.evaluate(() => ({ nodes: window._app.state.nodes, members: window._app.state.members }));
  await page.locator('#menu-view-trigger').click();
  await expect(page.locator('#menu-view select')).toHaveCount(0);
  await page.locator('#btn-display-settings').click();
  await expect(page.locator('#display-settings-dialog fieldset')).toHaveCount(3);
  await page.locator('#chk-show-members').uncheck();
  await page.locator('[data-close-dialog="display-settings-dialog"]').click();
  await expect(page.locator('#placement-visibility-note')).toBeVisible();
  expect(await page.evaluate(() => ({ nodes: window._app.state.nodes, members: window._app.state.members }))).toEqual(before);
  await page.locator('#placement-visibility-note button').click();
  await page.locator('#chk-show-members').check();
  await page.locator('[data-close-dialog="display-settings-dialog"]').click();
  await expect(page.locator('#placement-visibility-note')).toBeHidden();
});

test('exterior wall guide and Enter use the same polyline placement mode', async ({ page }) => {
  await page.locator('[data-draw-type="floor"]').click();
  await page.locator('#sel-surface-type').selectOption('exteriorWall');
  await expect(page.locator('#placement-guide')).toContainText('Enter');
  await clickPoint(page, 0, 0);
  await clickPoint(page, 3000, 0);
  await clickPoint(page, 3000, 3000);
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window._app.state.surfaces.length)).toBe(1);
  expect(await page.evaluate(() => window._app.state.surfaces[0].type)).toBe('exteriorWall');
});

test('switching tool during a provisional drag preserves the requested tool and original geometry', async ({ page }) => {
  await clickPoint(page, 0, 0);
  await clickPoint(page, 3000, 0);
  const original = await page.evaluate(() => window._app.state.toJSON());
  await page.locator('[data-draw-tool="select"]').click();
  const box = await page.locator('#canvas-2d').boundingBox();
  const point = await page.evaluate(() => window._app.canvas2d.worldToScreen(1500, 0));
  await page.mouse.move(box.x + point.x, box.y + point.y);
  await page.mouse.down();
  await page.mouse.move(box.x + point.x + 100, box.y + point.y - 100, { steps: 4 });
  await page.keyboard.press('m');
  await page.mouse.up();
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe('member');
  expect(await page.evaluate(() => window._app.state.toJSON())).toEqual(original);
});

test('Ctrl+Shift+Z restores a committed element and modal shortcuts do not touch it', async ({ page }) => {
  await clickPoint(page, 0, 0);
  await clickPoint(page, 3000, 0);
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+Shift+Z');
  expect(await page.evaluate(() => window._app.state.members.length)).toBe(1);
  await page.locator('[data-draw-tool="select"]').click();
  await clickPoint(page, 1500, 0);
  expect(await page.evaluate(() => window._app.state.selectedMemberId)).toBeTruthy();
  await page.locator('#btn-settings').click();
  await page.keyboard.press('Delete');
  await page.keyboard.press('m');
  expect(await page.evaluate(() => window._app.state.currentTool)).toBe('select');
  await page.locator('#btn-settings-close').click();
  expect(await page.evaluate(() => window._app.state.members.length)).toBe(1);
});
