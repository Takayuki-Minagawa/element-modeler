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

async function openModel(page, { selected = false } = {}) {
  const model = buildBenchmarkState(AppState, 9).toJSON();
  await page.locator('#file-import').setInputFiles({
    name: 'navigation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect.poll(() => page.evaluate(() => window._app.state.members.length)).toBe(9);
  if (selected) {
    await page.locator('#sel-tool').selectOption('select');
    const point = await page.evaluate(() => window._app.canvas2d.worldToScreen(2500, 0));
    await page.locator('#canvas-2d').click({ position: point });
    await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  }
  await page.locator('#tab-3d').click();
  await expect(page.locator('#viewer-3d canvas')).toBeVisible();
  await expect(page.locator('#viewer-tools [data-viewer-action="fit-all"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window._app.viewer3d.stats.rebuilds)).toBeGreaterThan(0);
  await settleCamera(page);
}

async function settleCamera(page) {
  await expect.poll(() => page.evaluate(() => {
    const frames = window._app.viewer3d._frames;
    return frames.pending === null && !frames.dirty;
  })).toBe(true);
}

const modelSnapshot = page => page.evaluate(() => ({
  model: window._app.state.toJSON(), undo: window._app.history.undoStack, redo: window._app.history.redoStack,
}));
const cameraSnapshot = page => page.evaluate(() => {
  const { camera, controls } = window._app.viewer3d;
  const round = value => Math.round(value * 1e9) / 1e9;
  return { position: camera.position.toArray().map(round), target: controls.target.toArray().map(round),
    direction: camera.position.clone().sub(controls.target).normalize().toArray().map(round),
    distance: round(camera.position.distanceTo(controls.target)) };
});

async function expectGeometryInView(page) {
  // Project rendered vertices, including beam depth and node spheres, rather
  // than only the model's plan coordinates or a camera implementation detail.
  await expect.poll(() => page.evaluate(() => {
    const viewer = window._app.viewer3d;
    viewer.scene.updateMatrixWorld(true);
    viewer.camera.updateMatrixWorld(true);
    let count = 0, outside = 0;
    const vertex = viewer.camera.position.clone();
    for (const group of viewer._contentGroups()) group.traverseVisible(object => {
      const positions = object.geometry?.attributes?.position;
      if (!positions) return;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld).project(viewer.camera);
        count++;
        if (![vertex.x, vertex.y, vertex.z].every(Number.isFinite)
          || Math.abs(vertex.x) >= 0.99 || Math.abs(vertex.y) >= 0.99 || Math.abs(vertex.z) >= 1) outside++;
      }
    });
    return { content: count > 0, outside };
  })).toEqual({ content: true, outside: 0 });
}

async function dragCanvas(page, { button = 'right', roundTrip = false, modifier = null } = {}) {
  const box = await page.locator('#viewer-3d canvas').boundingBox();
  const start = { x: box.x + box.width * 0.45, y: box.y + box.height * 0.35 };
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(start.x + box.width * 0.3, start.y + 55, { steps: 8 });
  if (roundTrip) await page.mouse.move(start.x, start.y, { steps: 8 });
  await page.mouse.up({ button });
  if (modifier) await page.keyboard.up(modifier);
  await settleCamera(page);
}

test('fit recovers the whole model after pan and zoom without changing its view direction or undo history', async ({ page }) => {
  await openModel(page);
  const model = await modelSnapshot(page);
  const initial = await cameraSnapshot(page);
  await dragCanvas(page);
  expect((await cameraSnapshot(page)).target).not.toEqual(initial.target);
  const box = await page.locator('#viewer-3d canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -800);
  await expect.poll(async () => (await cameraSnapshot(page)).distance).toBeLessThan(initial.distance * 0.8);
  await settleCamera(page);
  const displaced = await cameraSnapshot(page);
  await page.locator('#viewer-tools [data-viewer-action="fit-all"]').click();
  await settleCamera(page);
  await expectGeometryInView(page);
  const fitted = await cameraSnapshot(page);
  fitted.direction.forEach((value, index) => expect(value).toBeCloseTo(displaced.direction[index], 5));
  expect(fitted.target).not.toEqual(displaced.target);
  expect(await modelSnapshot(page)).toEqual(model);
});

test('initial framing and all four view presets keep geometry inside a narrow 768px workspace', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await openModel(page);
  await expectGeometryInView(page);
  const model = await modelSnapshot(page);
  for (const preset of ['top', 'front', 'right', 'oblique']) {
    await page.locator(`#viewer-tools [data-view-preset="${preset}"]`).click();
    await settleCamera(page);
    await expectGeometryInView(page);
    const { direction } = await cameraSnapshot(page);
    if (preset === 'oblique') direction.forEach(value => expect(value).toBeGreaterThan(0.2));
    else {
      const axis = { right: 0, top: 1, front: 2 }[preset];
      direction.forEach((value, index) => expect(value).toBeCloseTo(index === axis ? 1 : 0, 4));
    }
  }
  await page.locator('#viewer-tools [data-viewer-action="fit-all"]').click();
  await expectGeometryInView(page);
  expect(await modelSnapshot(page)).toEqual(model);
});

test('pan and orbit gestures retain selection, including a drag returning to its start, while ordinary clicks still pick', async ({ page }) => {
  await openModel(page, { selected: true });
  const initial = await cameraSnapshot(page);
  await dragCanvas(page);
  expect((await cameraSnapshot(page)).target).not.toEqual(initial.target);
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  await dragCanvas(page, { button: 'left', modifier: 'Shift' });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  await dragCanvas(page, { button: 'left', roundTrip: true });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');

  await page.locator('#viewer-tools [data-view-preset="top"]').click();
  await settleCamera(page);
  const canvas = page.locator('#viewer-3d canvas');
  await canvas.click({ position: { x: 12, y: 12 } });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBeNull();
  const point = await page.evaluate(() => {
    const viewer = window._app.viewer3d;
    const object = viewer._visuals.get('member:M1').find(item => item.isMesh);
    object.geometry.computeBoundingBox();
    const center = object.geometry.boundingBox.getCenter(viewer.camera.position.clone())
      .applyMatrix4(object.matrixWorld).project(viewer.camera);
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    return { x: (center.x + 1) * rect.width / 2, y: (1 - center.y) * rect.height / 2 };
  });
  await canvas.click({ position: point });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
});

test('wheel zoom keeps the world point under the cursor stationary in a top view', async ({ page }) => {
  await openModel(page, { selected: true });
  await page.locator('#viewer-tools [data-view-preset="top"]').click();
  await settleCamera(page);
  const anchor = await page.evaluate(() => {
    const { camera, controls, renderer } = window._app.viewer3d;
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = { x: 0.3, y: 0.2 };
    const ray = camera.position.clone().set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    const point = camera.position.clone().addScaledVector(ray, (controls.target.y - camera.position.y) / ray.y);
    return { world: point.toArray(), x: rect.x + (ndc.x + 1) * rect.width / 2,
      y: rect.y + (1 - ndc.y) * rect.height / 2, distance: camera.position.distanceTo(controls.target) };
  });
  await page.mouse.move(anchor.x, anchor.y);
  await page.mouse.wheel(0, -150);
  await expect.poll(async () => (await cameraSnapshot(page)).distance).toBeLessThan(anchor.distance);
  await settleCamera(page);
  const projected = await page.evaluate(world => {
    const { camera, renderer } = window._app.viewer3d;
    const point = camera.position.clone().fromArray(world).project(camera);
    const rect = renderer.domElement.getBoundingClientRect();
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  }, anchor.world);
  expect(Math.abs(projected.x - anchor.x)).toBeLessThan(1);
  expect(Math.abs(projected.y - anchor.y)).toBeLessThan(1);
  expect(await page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
});

test('fit and preset buttons preserve clipping, isolation and the selected member', async ({ page }) => {
  await openModel(page, { selected: true });
  const host = page.locator('#viewer-tools');
  await host.getByRole('button', { name: /Isolate selection|選択を単独表示/ }).click();
  await host.locator('select').selectOption('X');
  await host.locator('input[type="range"]').fill('2500');
  await host.locator('input[type="range"]').dispatchEvent('input');
  const snapshot = await page.evaluate(() => ({
    clipping: window._app.viewer3d.clipping, isolation: [...window._app.viewer3d._isolation],
    selected: window._app.state.selectedMemberId,
  }));
  const model = await modelSnapshot(page);
  for (const control of ['[data-viewer-action="fit-all"]', '[data-view-preset="right"]', '[data-view-preset="top"]']) {
    await host.locator(control).click();
    await settleCamera(page);
    expect(await page.evaluate(() => ({
      clipping: window._app.viewer3d.clipping, isolation: [...window._app.viewer3d._isolation],
      selected: window._app.state.selectedMemberId,
    }))).toEqual(snapshot);
    // Only M1's retained half should determine the target, not the other rows.
    const { target } = await cameraSnapshot(page);
    expect(target[0]).toBeCloseTo(1.25, 2);
    expect(Math.abs(target[2])).toBeLessThan(0.2);
  }
  expect(await modelSnapshot(page)).toEqual(model);
});

test('canvas Home and F work with the right sidebar closed without adding undo steps', async ({ page }) => {
  await openModel(page, { selected: true });
  await page.locator('#btn-toggle-property').click();
  await expect(page.locator('#viewer-tools')).toBeHidden();
  const model = await modelSnapshot(page);
  await dragCanvas(page);
  const canvas = page.locator('#viewer-3d canvas');
  await expect(canvas).toHaveAttribute('tabindex', '0');
  await canvas.focus();
  await page.keyboard.press('Home');
  await settleCamera(page);
  await expectGeometryInView(page);
  const all = await cameraSnapshot(page);
  await page.keyboard.press('f');
  await settleCamera(page);
  const selection = await cameraSnapshot(page);
  expect(selection.target[0]).toBeCloseTo(2.5, 2);
  expect(selection.distance).toBeLessThan(all.distance);
  expect(await page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  await expect(page.locator('#viewer-tools')).toBeHidden();
  expect(await modelSnapshot(page)).toEqual(model);
});

test('navigation shortcuts ignore form inputs, other focused controls, modifiers and IME composition', async ({ page }) => {
  await openModel(page, { selected: true });
  await dragCanvas(page);
  // OrbitControls stops scheduling below its change threshold but can retain
  // a small pan delta. Finish that motion before testing keyboard ownership.
  await page.evaluate(() => {
    const controls = window._app.viewer3d.controls;
    controls.enableDamping = false;
    controls.update();
  });
  await settleCamera(page);
  const camera = await cameraSnapshot(page);
  await page.locator('#viewer-tools select').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('f');
  await page.locator('#viewer-tools select').selectOption('X');
  await page.locator('#viewer-tools input[type="number"]').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('f');
  await page.locator('#viewer-tools select').selectOption('');
  await page.locator('#tab-3d').focus();
  await page.keyboard.press('Home');
  const canvas = page.locator('#viewer-3d canvas');
  await canvas.focus();
  await page.keyboard.press('Shift+Home');
  await page.keyboard.press('Shift+f');
  await canvas.dispatchEvent('keydown', { key: 'Home', code: 'Home', isComposing: true });
  await canvas.dispatchEvent('keydown', { key: 'f', code: 'KeyF', isComposing: true });
  const browserFindPrevented = await canvas.evaluate(element => ['ctrlKey', 'metaKey'].map(modifier => {
    // Synthetic events check browser-search ownership without opening a native
    // Find dialog, which Playwright cannot close consistently across engines.
    const event = new KeyboardEvent('keydown', {
      key: 'f', code: 'KeyF', bubbles: true, cancelable: true, [modifier]: true,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }));
  expect(browserFindPrevented).toEqual([false, false]);
  await settleCamera(page);
  expect(await cameraSnapshot(page)).toEqual(camera);
  // The same focused canvas accepts the unmodified shortcut immediately after.
  await page.keyboard.press('Home');
  await settleCamera(page);
  expect((await cameraSnapshot(page)).target).not.toEqual(camera.target);
  await expectGeometryInView(page);
});

test('an interrupted pointer gesture preserves selection and the next click and pan work immediately', async ({ page }) => {
  await openModel(page, { selected: true });
  const canvas = page.locator('#viewer-3d canvas');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 12, box.y + 12);
  const camera = await cameraSnapshot(page);
  await page.mouse.down();
  // Model an operating-system focus interruption explicitly. Headless tabs do
  // not consistently emit blur, and separate page.mouse instances retain
  // independent pressed-button state, so switching tabs is not a reliable
  // way to exercise this lifecycle with native subsequent input.
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.up();
  await settleCamera(page);
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBe('M1');
  expect(await cameraSnapshot(page)).toEqual(camera);

  await canvas.click({ position: { x: 12, y: 12 } });
  await expect.poll(() => page.evaluate(() => window._app.state.selectedMemberId)).toBeNull();
  await dragCanvas(page);
  expect((await cameraSnapshot(page)).target).not.toEqual(camera.target);
});
