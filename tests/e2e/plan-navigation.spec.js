import { test, expect } from '@playwright/test';
import { installOfflineRoutes } from './offline.mjs';

test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window._app))).toBe(true);
});

async function worldPoint(page, x, y) {
  const canvas = await page.locator('#canvas-2d').boundingBox();
  const point = await page.evaluate(([x, y]) => window._app.canvas2d.worldToScreen(x, y), [x, y]);
  return { x: canvas.x + point.x, y: canvas.y + point.y };
}

async function createBeam(page) {
  await page.locator('[data-draw-type="beam"]').click();
  for (const x of [0, 6000]) {
    const point = await worldPoint(page, x, 0);
    await page.mouse.click(point.x, point.y);
  }
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(1);
}

function modelSnapshot(page) {
  return page.evaluate(() => {
    const { state, history } = window._app;
    return { model: state.toJSON(), revision: state.revision,
      selection: [state.selectedMemberId, state.selectedMemberIds, state.selectedSurfaceId, state.selectedLoadId, state.selectedSupportId],
      tool: state.currentTool, undo: history.undoStack.length, redo: history.redoStack.length };
  });
}
const camera = page => page.evaluate(() => ({ ...window._app.canvas2d.camera }));

test('left-drag pan over a selected beam moves only the camera and Escape returns to selection', async ({ page }) => {
  await createBeam(page);
  await page.locator('[data-draw-tool="select"]').click();
  const start = await worldPoint(page, 3000, 0);
  await page.mouse.click(start.x, start.y);
  const before = await modelSnapshot(page);
  const initial = await camera(page);
  const pan = page.locator('#btn-plan-pan');
  await pan.focus();
  await page.keyboard.press('Space');
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#canvas-2d')).toHaveCSS('cursor', 'grab');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.locator('#canvas-2d')).toHaveCSS('cursor', 'grabbing');
  await page.mouse.move(start.x + 120, start.y - 80, { steps: 5 });
  await page.mouse.up();
  expect(await camera(page)).toEqual({ ...initial, offsetX: initial.offsetX + 120, offsetY: initial.offsetY - 80 });
  expect(await modelSnapshot(page)).toEqual(before);
  if (test.info().project.name === 'chromium') {
    await page.screenshot({ path: 'test-results/ui-review/plan-navigation.png' });
  }
  await page.locator('#canvas-2d').focus();
  await page.keyboard.press('Escape');
  await expect(pan).toHaveAttribute('aria-pressed', 'false');
  expect(await modelSnapshot(page)).toEqual(before);
  const moved = await worldPoint(page, 3000, 0);
  await page.mouse.click(moved.x, moved.y);
  expect((await modelSnapshot(page)).selection).toEqual(before.selection);
});

test('pan preserves an unfinished beam and changing tools exits pan mode', async ({ page }) => {
  await page.locator('[data-draw-type="beam"]').click();
  const start = await worldPoint(page, 0, 0);
  await page.mouse.click(start.x, start.y);
  await page.locator('#btn-plan-pan').click();
  const before = await modelSnapshot(page);
  await page.mouse.move(start.x + 40, start.y - 50);
  await page.mouse.down();
  await page.mouse.move(start.x + 140, start.y - 100, { steps: 4 });
  await page.mouse.up();
  expect(await modelSnapshot(page)).toEqual(before);
  await page.locator('#btn-plan-pan').click();
  const end = await worldPoint(page, 6000, 0);
  await page.mouse.click(end.x, end.y);
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(1);
  await page.locator('#btn-plan-pan').click();
  await page.locator('[data-draw-tool="select"]').click();
  await expect(page.locator('#btn-plan-pan')).toHaveAttribute('aria-pressed', 'false');
});

for (const gesture of ['right', 'middle', 'space']) {
  test(`${gesture} pan stops after release outside the canvas`, async ({ page }) => {
    await createBeam(page);
    const before = await modelSnapshot(page);
    const initial = await camera(page);
    const box = await page.locator('#canvas-2d').boundingBox();
    const start = { x: box.x + 100, y: box.y + 100 };
    const button = gesture === 'space' ? 'left' : gesture;
    await page.locator('#canvas-2d').focus();
    if (gesture === 'space') await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down({ button });
    await page.mouse.move(box.x - 30, start.y + 40, { steps: 5 });
    await page.mouse.up({ button });
    if (gesture === 'space') await page.keyboard.up('Space');
    const released = await camera(page);
    expect(released).toEqual({ ...initial, offsetX: initial.offsetX - 130, offsetY: initial.offsetY + 40 });
    await page.mouse.move(start.x + 100, start.y + 100);
    expect(await camera(page)).toEqual(released);
    expect(await modelSnapshot(page)).toEqual(before);
  });
}

test('Space release, window blur and pointer cancellation end active panning', async ({ page }) => {
  const box = await page.locator('#canvas-2d').boundingBox();
  const start = { x: box.x + 150, y: box.y + 150 };
  for (const end of ['space', 'blur', 'pointercancel']) {
    await page.locator('#canvas-2d').focus();
    await page.keyboard.down('Space');
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 30);
    if (end === 'space') await page.keyboard.up('Space');
    if (end === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    if (end === 'pointercancel') await page.locator('#canvas-2d').dispatchEvent('pointercancel');
    const released = await camera(page);
    await page.mouse.move(start.x + 90, start.y + 80);
    expect(await camera(page)).toEqual(released);
    await page.mouse.up();
    await page.keyboard.up('Space');
    await expect(page.locator('#canvas-2d')).not.toHaveCSS('cursor', 'grabbing');
  }
  expect(await page.evaluate(() => window._app.state.members.length)).toBe(0);
});

test('fit centers displayed members, surfaces, loads and supports without revealing other levels', async ({ page }) => {
  await page.evaluate(() => {
    const { state, canvas2d, update } = window._app;
    const a = state.addNode(0, 0), b = state.addNode(6000, 0);
    const member = state.addMember(a.id, b.id, { type: 'beam', levelId: 'L0' });
    state.addSurfaceRect(0, 0, 6000, 4000, { levelId: 'L0' });
    state.addLoad('pointLoad', { x1: 8000, y1: 4000, levelId: 'L0' });
    state.addSupport(0, 6000, { levelId: 'L0' });
    const c = state.addNode(1e6, 1e6), d = state.addNode(1e6 + 6000, 1e6);
    state.addMember(c.id, d.id, { type: 'beam', levelId: 'L1' });
    state.updateSetting('planLayerDisplayMode', 'current');
    state.select('member', member.id);
    canvas2d.pan(-2000, 2000);
    update();
  });
  const before = await modelSnapshot(page);
  await page.locator('#btn-plan-fit').click();
  const fit = await page.evaluate(() => {
    const { canvas2d } = window._app;
    return { center: canvas2d.worldToScreen(4000, 3000),
      min: canvas2d.worldToScreen(0, 0), max: canvas2d.worldToScreen(8000, 6000),
      width: canvas2d.logicalWidth, height: canvas2d.logicalHeight };
  });
  expect(fit.center.x).toBeCloseTo(fit.width / 2, 3);
  expect(fit.center.y).toBeCloseTo(fit.height / 2, 3);
  expect(fit.min.x).toBeGreaterThan(0);
  expect(fit.min.y).toBeLessThan(fit.height);
  expect(fit.max.x).toBeLessThan(fit.width);
  expect(fit.max.y).toBeGreaterThan(0);
  expect(await modelSnapshot(page)).toEqual(before);
});

test('navigation hides in 3D, translates, fits narrow screens and leaves Space in form fields', async ({ page }) => {
  await page.locator('#tab-3d').click();
  await expect(page.locator('#plan-navigation')).toBeHidden();
  await page.locator('#tab-2d').click();
  await expect(page.locator('#plan-navigation')).toBeVisible();
  await page.locator('#btn-settings').click();
  await page.locator('#settings-lang').selectOption('en');
  await page.locator('#btn-settings-close').click();
  await expect(page.locator('#btn-plan-pan')).toHaveText('Pan view');
  await expect(page.locator('#btn-plan-fit')).toHaveText('Fit to view');
  await page.locator('#sel-tool').focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Escape');
  await expect(page.locator('#btn-plan-pan')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#canvas-2d')).not.toHaveClass(/pan-ready/);
  await page.setViewportSize({ width: 768, height: 768 });
  await expect(page.locator('#btn-plan-pan')).toBeInViewport();
  await expect(page.locator('#btn-plan-fit')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(768);
});
