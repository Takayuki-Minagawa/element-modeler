import test from 'node:test';
import assert from 'node:assert/strict';
import { Canvas2D } from '../js/canvas2d.js';
import { AppState } from '../js/state.js';

function fixture() {
  const pending = new Map(); let id = 0;
  globalThis.requestAnimationFrame = cb => { pending.set(++id, cb); return id; };
  globalThis.cancelAnimationFrame = id => pending.delete(id);
  globalThis.window = new EventTarget(); window.devicePixelRatio = 2;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#123456' });
  let observer;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observer = this; }
    observe() {} disconnect() { this.disconnected = true; }
  };
  const arcs = [], lines = [];
  const ctx = new Proxy({
    measureText: () => ({ width: 20 }),
    arc: (...args) => arcs.push(args),
    lineTo: (...args) => lines.push(args),
  }, {
    get: (object, key) => key in object ? object[key] : () => {},
  });
  const element = new EventTarget();
  Object.assign(element, { hidden: false, parentElement: { clientWidth: 800, clientHeight: 600 }, style: {}, getContext: () => ctx });
  const state = new AppState();
  const canvas = new Canvas2D(element, state);
  const flush = () => { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(cb => cb()); };
  return { canvas, element, state, pending, observer, flush, arcs, lines };
}

test('forced synchronous 2D export draws the current model while inactive or hidden without scheduling frames', () => {
  for (const [active, hidden] of [[false, false], [true, true], [false, true]]) {
    const { canvas, element, state, pending, flush, lines } = fixture();
    const a = state.addNode(0, 0), b = state.addNode(1000, 0);
    state.addMember(a.id, b.id);
    flush();
    if (!active) canvas.setActive(false);
    element.hidden = hidden;
    state.updateNode(b.id, { x: 2000 });
    lines.length = 0;
    const before = canvas.stats.frames;

    canvas.draw();
    assert.equal(canvas.stats.frames, before);
    assert.equal(lines.length, 0);

    canvas.draw({ force: true });
    const endpoint = canvas.worldToScreen(2000, 0);
    assert.ok(lines.some(([x, y]) => x === endpoint.x && y === endpoint.y));
    assert.equal(canvas.stats.frames, before + 1);
    assert.equal(canvas._frames.active, active);
    assert.equal(element.hidden, hidden);
    assert.equal(pending.size, 0);

    // Force bypasses the idle cache even when nothing else has changed.
    canvas.draw({ force: true });
    assert.equal(canvas.stats.frames, before + 2);
    assert.equal(pending.size, 0);
    canvas.dispose();
    canvas.draw({ force: true });
    assert.equal(canvas.stats.frames, before + 2);
  }
});

test('2D coalesces draw/input/resize, draws latest mutable previews, stops when hidden and disposes', () => {
  const { canvas, element, pending, observer, flush } = fixture();
  assert.equal(pending.size, 1); flush();
  assert.equal(canvas.stats.frames, 1); assert.equal(pending.size, 0);
  canvas.draw(); canvas.draw(); assert.equal(canvas.stats.frames, 1);
  let previewX;
  canvas._drawPreview = () => { previewX = canvas.preview?.endX; };
  canvas.preview = { mode: 'line', startX: 0, startY: 0, endX: 100, endY: 0 };
  canvas.preview.endX = 500; // changed after invalidation, before onUpdate
  canvas.measure = { x1: 0, y1: 0, x2: 300, y2: 100 };
  for (let i = 0; i < 20; i++) element.dispatchEvent(new Event('mousemove'));
  canvas.requestDraw(); assert.equal(pending.size, 1); flush();
  assert.equal(previewX, 500); assert.equal(canvas.stats.frames, 2);
  element.parentElement.clientWidth = 1000; observer.callback(); flush();
  assert.equal(canvas.logicalWidth, 1000); assert.equal(element.width, 2000);
  canvas.pan(10, 20); canvas.zoom(-1, 200, 100); assert.equal(pending.size, 1); flush();
  canvas.setActive(false); element.hidden = true;
  observer.callback(); canvas.preview = null; element.dispatchEvent(new Event('mousemove'));
  assert.equal(pending.size, 0);
  const frames = canvas.stats.frames;
  element.hidden = false; canvas.setActive(true); flush();
  assert.equal(canvas.stats.frames, frames + 1);
  canvas.requestDraw(); canvas.dispose(); canvas.dispose();
  element.dispatchEvent(new Event('mousemove')); observer.callback(); flush();
  assert.equal(observer.disconnected, true); assert.equal(pending.size, 0);
  assert.equal(canvas.stats.frames, frames + 1);
});

test('hidden 2D exports retain the plan viewport and activation applies deferred layout changes', () => {
  const { canvas, element, pending, observer, flush } = fixture();
  flush();
  const dimensions = () => [canvas.logicalWidth, canvas.logicalHeight, element.width, element.height];
  const visibleDimensions = dimensions();
  canvas.setActive(false);
  element.hidden = true;
  element.parentElement.clientHeight = 650;
  observer.callback();
  canvas.draw({ force: true });
  assert.deepEqual(dimensions(), visibleDimensions);
  assert.equal(pending.size, 0);

  // A browser/panel resize in 3D is applied once the plan is shown again.
  element.parentElement.clientWidth = 900;
  element.parentElement.clientHeight = 700;
  element.hidden = false;
  canvas.setActive(true);
  flush();
  assert.deepEqual(dimensions(), [900, 700, 1800, 1400]);
  canvas.dispose();
});

test('2D indexes replace linear searches and highlight endpoints of every selected member', () => {
  const { canvas, state, flush } = fixture();
  const a = state.addNode(0, 0), b = state.addNode(1000, 0), c = state.addNode(2000, 0);
  const m1 = state.addMember(a.id, b.id), m2 = state.addMember(b.id, c.id);
  state.selectMembers([m1.id, m2.id]);
  state.getNode = () => { throw new Error('Rendering must use the index'); };
  state.getMember = () => { throw new Error('Rendering must use the index'); };
  state.isMemberSelected = () => { throw new Error('Rendering must use a selection Set'); };
  flush();
  assert.deepEqual([...canvas._selectedNodeIds], [a.id, b.id, c.id]);
  assert.equal(canvas._index.membersByLevel.get(state.activeLevelId).length, 2);
  state.clearSelection(); canvas.requestDraw(); flush();
  assert.equal(canvas._selectedNodeIds.size, 0);
  state.nodes = [{ ...a, x: 100 }]; state.members = [];
  canvas.requestDraw(); flush();
  assert.equal(canvas._index.nodesById.get(a.id).x, 100);
  assert.equal(canvas._index.membersById.size, 0);
  canvas.dispose();
});
