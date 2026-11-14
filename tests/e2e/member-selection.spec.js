import { test, expect } from '@playwright/test';
import { AppState } from '../../js/state.js';
import { installOfflineRoutes } from './offline.mjs';

const errors = new WeakMap();
test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const messages = [];
  errors.set(page, messages);
  page.on('pageerror', error => messages.push(error.message));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

// GL: two connected beams and a column to 2F. 2F: a beam on the column top and
// a beam that shares GL plan nodes only. A detached GL beam stays separate.
function fixture() {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(4000, 0), c = state.addNode(8000, 0), far = state.addNode(0, 5000), far2 = state.addNode(4000, 5000);
  const ids = {
    gl1: state.addMember(a.id, b.id, { type: 'beam', levelId: 'L0' }).id,
    gl2: state.addMember(b.id, c.id, { type: 'beam', levelId: 'L0' }).id,
    column: state.addMember(c.id, c.id, { type: 'column', levelId: 'L0', topLevelId: 'L1' }).id,
    top: state.addMember(b.id, c.id, { type: 'beam', levelId: 'L1' }).id,
    detached: state.addMember(far.id, far2.id, { type: 'beam', levelId: 'L0' }).id,
    sharedPlan: state.addMember(a.id, far.id, { type: 'beam', levelId: 'L1' }).id,
  };
  return { model: state.toJSON(), ids };
}

async function importModel(page, model) {
  await page.locator('#file-import').setInputFiles({
    name: 'selection.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.locator('.app-notice-success')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(model.members.length);
  await page.locator('[data-draw-tool="select"]').click();
  await page.evaluate(() => {
    const { state } = window._app;
    state.settings.planLayerDisplayMode = 'all';
    state.settings.planLayerSelectionLock = false;
    window._app.update();
  });
}

const selected = page => page.evaluate(() => [...window._app.state.selectedMemberIds].sort());
const snapshot = page => page.evaluate(() => ({
  revision: window._app.state.revision,
  undo: window._app.history.undoStack.length,
  redo: window._app.history.redoStack.length,
}));

async function runMenu(page, command) {
  await page.locator('#menu-edit-trigger').click();
  await page.locator(`[data-member-selection="${command}"]`).click();
}

test('edit menu selects connected and inverted members without changing the model', async ({ page }) => {
  const { model, ids } = fixture();
  await importModel(page, model);
  const before = await snapshot(page);
  await page.evaluate(id => { window._app.state.select('member', id); window._app.update(); }, ids.gl1);

  await runMenu(page, 'connected');
  await expect.poll(() => selected(page)).toEqual([ids.gl1, ids.gl2, ids.column, ids.top].sort());
  await expect(page.locator('.app-notice-success').last()).toContainText('4');

  await runMenu(page, 'invert');
  await expect.poll(() => selected(page)).toEqual([ids.detached, ids.sharedPlan].sort());

  await page.locator('#canvas-2d').focus();
  await page.keyboard.press('ControlOrMeta+a');
  await expect.poll(() => selected(page)).toEqual(Object.values(ids).sort());
  expect(await snapshot(page)).toEqual(before);
});

test('select all skips locked layers and leaves form controls and the 3D tab alone', async ({ page }) => {
  const { model, ids } = fixture();
  await importModel(page, model);
  await page.evaluate(() => {
    const { state } = window._app;
    state.activeLevelId = 'L1';
    state.settings.planLayerDisplayMode = 'halftone';
    state.settings.planLayerSelectionLock = true;
    window._app.update();
  });
  await runMenu(page, 'all');
  await expect.poll(() => selected(page)).toEqual([ids.top, ids.sharedPlan].sort());

  await page.evaluate(() => { window._app.state.clearSelection(); window._app.update(); });
  const input = page.getByRole('combobox', { name: '入力する階' });
  await input.focus();
  await expect(input).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selected(page)).toEqual([]);

  await page.locator('#tab-3d').click();
  await expect(page.locator('#canvas-2d')).toBeHidden();
  await page.locator('body').focus();
  await page.keyboard.press('ControlOrMeta+a');
  expect(await selected(page)).toEqual([]);
});

test('connected selection asks for a member when none is selected', async ({ page }) => {
  const { model } = fixture();
  await importModel(page, model);
  await runMenu(page, 'connected');
  await expect(page.locator('.app-notice-error')).toBeVisible();
  expect(await selected(page)).toEqual([]);
});
