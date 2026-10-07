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
  const model = buildBenchmarkState(AppState, 2).toJSON();
  await page.locator('#file-import').setInputFiles({ name: 'clipping.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)) });
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(model.members.length);
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-tools input[type="number"]')).toBeVisible();
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function documentState(page) {
  return page.evaluate(() => ({ model: window._app.state.toJSON(),
    undo: window._app.history.undoStack.length, redo: window._app.history.redoStack.length }));
}

test('clipping accepts exact millimeters and keeps slider, axis and flip synchronized without editing CAD', async ({ page }) => {
  const host = page.locator('#viewer-tools');
  const position = host.getByRole('spinbutton', { name: '位置 (mm)' });
  const slider = host.locator('input[type="range"]');
  const before = await documentState(page);
  await expect(position).toBeDisabled();
  await host.locator('select').selectOption('X');
  await position.fill('2345.75');
  await position.press('Enter');
  await expect(slider).toHaveValue('2345.75');
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping))
    .toEqual({ axis: 'X', positionMm: 2345.75, flipped: false });
  await host.locator('input[type="checkbox"]').check();
  await expect(position).toHaveValue('2345.75');
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping.flipped)).toBe(true);
  await slider.fill('1250.5');
  await slider.dispatchEvent('input');
  await expect(position).toHaveValue('1250.5');
  await host.locator('select').selectOption('Y');
  expect(await position.inputValue()).toBe(await slider.inputValue());
  await host.locator('select').selectOption('');
  await expect(position).toBeDisabled();
  await expect(position).toHaveValue('');
  await expect(slider).toBeDisabled();
  expect(await page.evaluate(() => window._app.viewer3d.clipping)).toBeNull();
  expect(await documentState(page)).toEqual(before);
});

test('invalid numeric clipping leaves the last valid plane intact and users can correct it', async ({ page }) => {
  const host = page.locator('#viewer-tools');
  const position = host.locator('input[type="number"]');
  await host.locator('select').selectOption('X');
  await position.fill('1500');
  await position.press('Enter');
  const before = await documentState(page);
  for (const invalid of ['', '-100000', '100000']) {
    await position.fill(invalid);
    await position.press('Enter');
    await expect(position).toHaveValue('1500');
    await expect(host.locator('output')).toContainText('表示範囲内の数値');
    expect(await page.evaluate(() => window._app.viewer3d.clipping.positionMm)).toBe(1500);
  }
  await position.fill('2000');
  await position.press('Tab');
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.clipping.positionMm)).toBe(2000);
  await expect(host.locator('output')).toBeEmpty();
  expect(await documentState(page)).toEqual(before);
});
