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

function fixture({ otherLevel = false } = {}) {
  const state = new AppState();
  const beam = (x1, y1, x2, y2, levelId = 'L0') => {
    const a = state.addNode(x1, y1), b = state.addNode(x2, y2);
    return state.addMember(a.id, b.id, { type: 'beam', levelId });
  };
  const crossing = beam(-6000, 0, 6000, 0);
  const inside = beam(-1000, 1000, 1000, 1000);
  const outside = beam(4000, 3000, 6000, 3000);
  const upper = otherLevel ? beam(-6000, -700, 6000, -700, 'L1') : null;
  return { model: state.toJSON(), crossing: crossing.id, inside: inside.id, outside: outside.id, upper: upper?.id };
}

async function importModel(page, model) {
  await page.locator('#file-import').setInputFiles({
    name: 'marquee.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.locator('.app-notice-success')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(model.members.length);
  await page.locator('[data-draw-tool="select"]').click();
}

async function worldPoint(page, x, y) {
  const box = await page.locator('#canvas-2d').boundingBox();
  const point = await page.evaluate(([x, y]) => window._app.canvas2d.worldToScreen(x, y), [x, y]);
  return { x: box.x + point.x, y: box.y + point.y };
}

async function beginMarquee(page, from, to, { additive = false } = {}) {
  const a = await worldPoint(page, ...from), b = await worldPoint(page, ...to);
  await page.locator('#canvas-2d').focus();
  if (additive) await page.keyboard.down('Shift');
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await expect.poll(() => page.evaluate(() => window._app.canvas2d.marquee !== null)).toBe(true);
}

async function finishMarquee(page) {
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(() => page.evaluate(() => window._app.canvas2d.marquee)).toBeNull();
}

async function marquee(page, from, to, options) {
  await beginMarquee(page, from, to, options);
  await finishMarquee(page);
}

const selected = page => page.evaluate(() => window._app.state.selectedMemberIds);
const persisted = page => page.evaluate(() => {
  const { state, history } = window._app;
  return { model: state.toJSON(), revision: state.revision,
    undo: history.undoStack.length, redo: history.redoStack.length };
});

test('left-to-right contains members and right-to-left crosses members with both endpoints outside', async ({ page }) => {
  const model = fixture();
  await importModel(page, model.model);
  const before = await persisted(page);
  await marquee(page, [-2000, -1500], [2000, 1500]);
  await expect.poll(() => selected(page)).toEqual([model.inside]);
  await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${model.inside}`);
  await marquee(page, [2000, -1500], [-2000, 1500]);
  await expect.poll(() => selected(page)).toEqual([model.crossing, model.inside]);
  await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${model.crossing}, ${model.inside}`);
  expect(await persisted(page)).toEqual(before);
});

test('Shift adds crossing hits once and Escape cancels the live rectangle while preserving selection and history', async ({ page }) => {
  const model = fixture();
  await importModel(page, model.model);
  const point = await worldPoint(page, 5000, 3000);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => selected(page)).toEqual([model.outside]);
  const before = await persisted(page);
  await beginMarquee(page, [2000, -1500], [-2000, 1500]);
  await page.keyboard.press('Escape');
  await finishMarquee(page);
  expect(await selected(page)).toEqual([model.outside]);
  for (let i = 0; i < 2; i++) {
    await marquee(page, [2000, -1500], [-2000, 1500], { additive: true });
    await expect.poll(() => selected(page)).toEqual([model.outside, model.crossing, model.inside]);
  }
  expect(await persisted(page)).toEqual(before);
});

test('crossing respects other-level selection locks and hidden members', async ({ page }) => {
  const model = fixture({ otherLevel: true });
  model.model.settings.planLayerDisplayMode = 'halftone';
  model.model.settings.planLayerSelectionLock = true;
  await importModel(page, model.model);
  const locked = await persisted(page);
  await marquee(page, [2000, -1500], [-2000, 1500]);
  await expect.poll(() => selected(page)).toEqual([model.crossing, model.inside]);
  expect(await persisted(page)).toEqual(locked);

  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '表示設定…', exact: true }).click();
  const display = page.getByRole('dialog', { name: '表示設定', exact: true });
  await display.getByLabel('他レイヤー選択ロック', { exact: true }).uncheck();
  await display.getByRole('button', { name: '閉じる', exact: true }).click();
  const unlocked = await persisted(page);
  await marquee(page, [2000, -1500], [-2000, 1500]);
  await expect.poll(() => selected(page)).toEqual([model.crossing, model.inside, model.upper]);
  expect(await persisted(page)).toEqual(unlocked);

  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '表示設定…', exact: true }).click();
  await display.getByLabel('線材', { exact: true }).uncheck();
  await display.getByRole('button', { name: '閉じる', exact: true }).click();
  const hidden = await persisted(page);
  await marquee(page, [2000, -1500], [-2000, 1500]);
  await expect.poll(() => selected(page)).toEqual([]);
  expect(await persisted(page)).toEqual(hidden);
});
