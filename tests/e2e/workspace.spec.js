import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { installOfflineRoutes } from './offline.mjs';

const pageErrors = new WeakMap();
test.afterEach(async ({ page }) => expect(pageErrors.get(page) || []).toEqual([]));

test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const errors = [];
  pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});

async function point(page, x, y) {
  const position = await page.evaluate(([x, y]) => window._app.canvas2d.worldToScreen(x, y), [x, y]);
  await page.locator('#canvas-2d').click({ position });
}
async function command(page, menu, id) {
  await page.locator('#menu-' + menu + '-trigger').click();
  await page.locator('#' + id).click();
}
const count = page => page.evaluate(() => window._app.state.members.length);

test('primary buttons create beams, columns and floors in plan, with button Undo/Redo', async ({ page }) => {
  await expect(page.locator('#inspector-properties')).toBeVisible();
  await expect(page.locator('#inspector-quantities')).toBeHidden();
  await page.locator('[data-draw-type="beam"]').click();
  await point(page, 0, 0);
  await point(page, 3000, 0);
  await expect.poll(() => count(page)).toBe(1);
  await page.locator('#workspace-context [data-history="undo"]').click();
  await expect.poll(() => count(page)).toBe(0);
  await page.locator('#workspace-context [data-history="redo"]').click();
  await expect.poll(() => count(page)).toBe(1);
  await page.locator('[data-draw-type="column"]').click();
  await expect(page.locator('#sel-member-type')).toHaveValue('column');
  await expect(page.locator('#placement-guide')).toContainText('1回');
  await point(page, 0, 0);
  await expect.poll(() => count(page)).toBe(2);
  await page.locator('[data-draw-type="floor"]').click();
  await expect(page.locator('#tool-opts-surface')).toBeVisible();
  await point(page, 0, 0);
  await point(page, 3000, 3000);
  await expect.poll(() => page.evaluate(() => window._app.state.surfaces.length)).toBe(1);
  await page.locator('#inspector-quantities-tab').click();
  await expect(page.locator('#quantity-content')).toBeVisible();
  await page.locator('[data-draw-tool="select"]').click();
  await point(page, 1500, 0);
  await expect(page.locator('#inspector-properties')).toBeVisible();
  await command(page, 'model', 'btn-model-check');
  await expect(page.locator('#inspector-checks')).toBeVisible();
  await expect(page.locator('#menu-model')).toBeHidden();
});

test('changing type or input level discards unfinished placement and returns from 3D to plan', async ({ page }) => {
  await page.locator('[data-draw-type="beam"]').click();
  await point(page, 0, 0);
  await page.locator('[data-draw-type="column"]').click();
  await page.locator('[data-draw-type="beam"]').click();
  await point(page, 2000, 0);
  await expect.poll(() => count(page)).toBe(0);
  await point(page, 4000, 0);
  await expect.poll(() => count(page)).toBe(1);
  await point(page, 0, 2000);
  await page.locator('#sel-active-layer').selectOption('L1');
  await point(page, 2000, 2000);
  await expect.poll(() => count(page)).toBe(1);
  await point(page, 4000, 2000);
  await expect.poll(() => count(page)).toBe(2);
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await page.locator('[data-draw-type="wall"]').click();
  await expect(page.locator('#canvas-2d')).toBeVisible();
  await expect(page.locator('[data-draw-type="wall"]')).toHaveAttribute('aria-pressed', 'true');
});

test('menus support keyboard navigation, dismiss outside and preserve selection on Escape/Delete', async ({ page }) => {
  await page.locator('[data-draw-type="beam"]').click();
  await point(page, 0, 0);
  await point(page, 3000, 0);
  await page.locator('[data-draw-tool="select"]').click();
  await point(page, 1500, 0);
  const selection = await page.evaluate(() => window._app.state.selectedMemberId);
  await page.locator('#menu-file-trigger').focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#btn-export')).toBeFocused();
  await page.keyboard.press('Delete');
  await expect.poll(() => count(page)).toBe(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu-file')).toBeHidden();
  await expect(page.locator('#menu-file-trigger')).toBeFocused();
  expect(await page.evaluate(() => window._app.state.selectedMemberId)).toBe(selection);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#menu-edit-trigger')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#menu-edit')).toBeVisible();
  await page.locator('#workspace-context').click();
  await expect(page.locator('#menu-edit')).toBeHidden();
  await command(page, 'edit', 'btn-delete-selection');
  await expect.poll(() => count(page)).toBe(0);
  await page.locator('#workspace-context [data-history="undo"]').click();
  await expect.poll(() => count(page)).toBe(1);
});

test('model menu opens generation, layers, copy, definitions; settings and help remain accessible', async ({ page }) => {
  for (const [id, modal, close] of [
    ['btn-grid-frame', '#grid-frame-modal', '#btn-grid-frame-close'],
    ['btn-layer-manage', '#layer-modal', '#btn-layer-close'],
    ['btn-open-user-def', '#user-def-modal', '#btn-user-def-close'],
    ['btn-copy-level-open', '#copy-level-dialog', '[data-close-dialog="copy-level-dialog"]'],
  ]) {
    await command(page, 'model', id);
    await expect(page.locator(modal)).toBeVisible();
    await page.locator(close).click();
    await expect(page.locator(modal)).toBeHidden();
  }
  await page.locator('#btn-settings').click();
  await page.locator('#settings-lang').selectOption('en');
  await page.locator('#settings-theme').selectOption('light');
  await page.locator('#btn-settings-close').click();
  await expect(page.locator('#menu-file-trigger')).toHaveText('File');
  await expect(page.locator('#placement-guide')).toContainText('Click');
  await command(page, 'help', 'btn-open-help');
  await expect(page.locator('#help-modal')).toBeVisible();
});

for (const width of [1440, 1024, 768]) {
  test('workspace and menus fit viewport ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await expect(page.locator('#sel-active-layer')).toBeInViewport();
    await expect(page.locator('[data-draw-type="beam"]')).toBeInViewport();
    for (const id of ['file', 'edit', 'model', 'view', 'analysis', 'help']) {
      await page.locator('#menu-' + id + '-trigger').click();
      const box = await page.locator('#menu-' + id).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(768);
      await page.keyboard.press('Escape');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const initiallyCollapsed = await page.locator('body').evaluate(el => el.classList.contains('property-collapsed'));
    if (!initiallyCollapsed) await page.locator('#btn-toggle-property').click();
    await expect(page.locator('#canvas-2d')).toBeVisible();
    // Canvas dimensions follow the panel layout on the next resize frame.
    await expect.poll(async () => (await page.locator('#canvas-2d').boundingBox()).width).toBeGreaterThan(width / 2);
    if (test.info().project.name === 'chromium') {
      if (!initiallyCollapsed) await page.locator('#btn-toggle-property').click();
      await mkdir('test-results/ui-review', { recursive: true });
      await page.screenshot({ path: 'test-results/ui-review/workspace-' + width + '.png' });
    }
  });
}
