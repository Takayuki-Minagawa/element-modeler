import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/state.js';
import { Canvas2D } from '../js/canvas2d.js';
import { fitVisiblePlan } from '../js/ui/plan-navigation.js';
import { fitPlanToPoints, MIN_PLAN_SCALE, MAX_PLAN_SCALE } from '../js/plan-camera.js';
import { drawGrid, snapToGrid } from '../js/grid.js';
import { applyModelImport } from '../js/persistence/model-import.js';

function canvas() {
  return { logicalWidth: 800, logicalHeight: 500, camera: {}, requestDraw() {},
    worldToScreen: Canvas2D.prototype.worldToScreen, screenToWorld: Canvas2D.prototype.screenToWorld };
}

function assertInside(view, x, y) {
  const point = view.worldToScreen(x, y);
  assert.ok(point.x > 0 && point.x < view.logicalWidth, `x=${point.x} is inside the view`);
  assert.ok(point.y > 0 && point.y < view.logicalHeight, `y=${point.y} is inside the view`);
}

test('fit frames a 300 m model and wheel zoom continues smoothly around the cursor', () => {
  const state = new AppState();
  const a = state.addNode(100000, 200000), b = state.addNode(400000, 200000);
  state.addMember(a.id, b.id, { levelId: 'L0' });
  const before = state.snapshot();
  const view = canvas();
  fitVisiblePlan(state, view);
  assertInside(view, a.x, a.y);
  assertInside(view, b.x, b.y);
  assert.ok(view.camera.scale < 0.005);
  const scale = view.camera.scale;
  const anchor = view.screenToWorld(180, 120);
  Canvas2D.prototype.zoom.call(view, -1, 180, 120);
  assert.equal(view.camera.scale, scale * 1.1);
  assert.ok(Math.abs(view.screenToWorld(180, 120).x - anchor.x) < 1e-8);
  assert.ok(Math.abs(view.screenToWorld(180, 120).y - anchor.y) < 1e-8);
  Canvas2D.prototype.zoom.call(view, 1, 180, 120);
  assert.equal(view.camera.scale, scale * 1.1 * 0.9);
  assert.deepEqual(state.snapshot(), before);
});

test('fit covers the coordinate input range and shares wheel scale limits', () => {
  const view = canvas();
  assert.equal(fitPlanToPoints(view, [{ x: -1e9, y: -1e9 }, { x: 1e9, y: 1e9 }]), true);
  assertInside(view, -1e9, -1e9);
  assertInside(view, 1e9, 1e9);
  view.camera.scale = MIN_PLAN_SCALE;
  Canvas2D.prototype.zoom.call(view, 1, 0, 0);
  assert.equal(view.camera.scale, MIN_PLAN_SCALE);
  view.camera.scale = MAX_PLAN_SCALE;
  Canvas2D.prototype.zoom.call(view, -1, 0, 0);
  assert.equal(view.camera.scale, MAX_PLAN_SCALE);
});

test('visible DXF line, polyline, circle and arc bounds participate in fit without changing the model', () => {
  const state = new AppState();
  const view = canvas();
  state.underlay = { name: 'offscreen.dxf', entities: [
    { type: 'line', x1: 100000, y1: 200000, x2: 106000, y2: 204000 },
    { type: 'polyline', points: [{ x: 108000, y: 201000 }, { x: 109000, y: 208000 }] },
    { type: 'circle', cx: 110000, cy: 210000, r: 5000 },
    { type: 'arc', cx: 96000, cy: 202000, r: 2000, startAngle: 0, endAngle: 90 },
  ] };
  const before = state.snapshot();
  fitVisiblePlan(state, view);
  assertInside(view, 94000, 200000);
  assertInside(view, 115000, 215000);
  assert.deepEqual(state.snapshot(), before);
  state.updateSetting('showUnderlay', false);
  fitVisiblePlan(state, view);
  assert.deepEqual(view.worldToScreen(0, 0), { x: 400, y: 250 });
});

test('fitting large polylines avoids argument-spread limits', () => {
  const state = new AppState();
  const view = canvas();
  state.underlay = { name: 'many-points.dxf', entities: [{ type: 'polyline',
    points: Array.from({ length: 150000 }, (_, index) => ({ x: index, y: index })) }] };
  fitVisiblePlan(state, view);
  assertInside(view, 0, 0);
  assertInside(view, 149999, 149999);
});

test('fit skips incomplete CAD underlay polylines just as the renderer does', () => {
  const state = new AppState();
  const a = state.addNode(100000, 200000), b = state.addNode(103000, 200000);
  state.addMember(a.id, b.id, { levelId: 'L0' });
  const view = canvas();
  fitVisiblePlan(state, view);
  const expectedCamera = { ...view.camera };
  const data = state.toJSON();
  for (const points of [undefined, null, {}, [], [{ x: -1e9, y: -1e9 }]]) {
    data.underlay = { name: 'incomplete-polyline.dxf', entities: [{ type: 'polyline', points }] };
    applyModelImport(data, state, null, { preserveCatalogs: false });
    const before = state.snapshot();
    fitVisiblePlan(state, view);
    assert.deepEqual(view.camera, expectedCamera);
    assertInside(view, a.x, a.y);
    assertInside(view, b.x, b.y);
    assert.deepEqual(state.snapshot(), before);
  }
});

test('grid drawing remains bounded at low zoom while configured snapping stays unchanged', t => {
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456' });
  t.after(() => Object.assign(globalThis, previous));
  const lines = [];
  let start;
  const ctx = new Proxy({
    moveTo: (x, y) => { start = [x, y]; },
    lineTo: (x, y) => { lines.push([...start, x, y]); },
  }, { get: (object, key) => key in object ? object[key] : () => {} });
  const gridSize = 1;
  const camera = { offsetX: 400, offsetY: 250, scale: MIN_PLAN_SCALE };
  drawGrid(ctx, camera, gridSize, 800, 500);
  assert.ok(lines.length < 130, `bounded line count: ${lines.length}`);
  const vertical = lines.filter(([x1, y1, x2, y2]) => x1 === x2 && y1 === 0 && y2 === 500);
  assert.ok(vertical.length > 10);
  assert.ok(vertical[1][0] - vertical[0][0] >= 12 - 1e-8);
  assert.deepEqual(snapToGrid(12.4, -8.6, gridSize), { x: 12, y: -9 });
  lines.length = 0;
  drawGrid(ctx, { offsetX: 80, offsetY: 420, scale: 0.05 }, 500, 800, 500);
  const xLines = [...new Set(lines.filter(([x1, y1, x2, y2]) =>
    x1 === x2 && y1 === 0 && y2 === 500 && x1 >= 0 && x1 <= 800).map(line => line[0]))].sort((a, b) => a - b);
  const yLines = [...new Set(lines.filter(([x1, y1, x2, y2]) =>
    y1 === y2 && x1 === 0 && x2 === 800 && y1 >= 0 && y1 <= 500).map(line => line[1]))].sort((a, b) => a - b);
  assert.deepEqual(xLines, Array.from({ length: 32 }, (_, index) => 5 + index * 25));
  assert.deepEqual(yLines, Array.from({ length: 20 }, (_, index) => 20 + index * 25));
});

test('fitting extreme finite CAD coordinates cannot trap grid drawing in an imprecise index loop', t => {
  const previous = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle };
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456' });
  t.after(() => Object.assign(globalThis, previous));
  const state = new AppState();
  const data = state.toJSON();
  data.nodes = [{ id: 1, x: 1e20, y: -1e20, z: 0 }];
  applyModelImport(data, state, null, { preserveCatalogs: false });
  const view = canvas();
  fitVisiblePlan(state, view);
  let strokes = 0;
  const ctx = new Proxy({ stroke() {
    // Fail quickly if a future regression stops the grid loop from advancing.
    assert.ok(++strokes < 150, 'grid drawing must have a bounded number of strokes');
  } }, { get: (object, key) => key in object ? object[key] : () => {} });
  drawGrid(ctx, view.camera, 500, view.logicalWidth, view.logicalHeight);
  assert.ok(strokes > 10);
  for (const offset of [Infinity, -Infinity, NaN]) {
    strokes = 0;
    drawGrid(ctx, { ...view.camera, offsetX: offset }, 500, 800, 500);
    drawGrid(ctx, { ...view.camera, offsetY: offset }, 500, 800, 500);
    assert.equal(strokes, 0);
  }
});
