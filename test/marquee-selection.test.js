import test from 'node:test';
import assert from 'node:assert/strict';
import { Canvas2D } from '../js/canvas2d.js';
import { AppState } from '../js/state.js';
import { marqueeSelectionMode, memberIdsInMarquee, segmentMatchesMarquee } from '../js/domain/marquee-selection.js';
import { toolHarness } from './helpers/ui-harness.js';

const windowBox = { x1: 0, y1: 0, x2: 10, y2: 10 };
const crossingBox = { x1: 10, y1: 10, x2: 0, y2: 0 };
const point = (x, y) => ({ x, y });

test('window selects only contained segments; crossing also selects intersecting segments', () => {
  const cases = [
    [point(1, 1), point(9, 9), true, true],
    [point(-5, 5), point(15, 5), false, true],
    [point(5, -5), point(5, 15), false, true],
    [point(-5, -5), point(15, 15), false, true],
    [point(-5, 0), point(15, 0), false, true],
    [point(-5, -5), point(0, 0), false, true],
    [point(-5, 6), point(4, 15), false, false], // overlapping bounds, no segment hit
    [point(0, -1), point(10, -1), false, false],
    [point(0, 0), point(10, 10), true, true],
    [point(5, 5), point(5, 5), true, true], // column seen from above
    [point(0, 0), point(0, 0), true, true],
    [point(11, 5), point(11, 5), false, false],
  ];
  for (const [a, b, enclosed, crossed] of cases) {
    for (const [start, end] of [[a, b], [b, a]]) {
      assert.equal(segmentMatchesMarquee(start, end, windowBox), enclosed, JSON.stringify([start, end, 'window']));
      assert.equal(segmentMatchesMarquee(start, end, crossingBox), crossed, JSON.stringify([start, end, 'crossing']));
    }
  }
});

test('direction depends only on horizontal drag and crossing includes a zero-height rectangle', () => {
  for (const [y1, y2] of [[0, 10], [10, 0]]) {
    assert.equal(marqueeSelectionMode({ x1: 0, y1, x2: 10, y2 }), 'window');
    assert.equal(marqueeSelectionMode({ x1: 10, y1, x2: 0, y2 }), 'crossing');
    assert.equal(segmentMatchesMarquee(point(-5, 5), point(15, 5), { x1: 10, y1, x2: 0, y2 }), true);
  }
  assert.equal(segmentMatchesMarquee(point(5, -5), point(5, 5), { x1: 10, y1: 0, x2: 0, y2: 0 }), true);
});

test('invalid or missing geometry never matches a selection rectangle', () => {
  for (const bad of [undefined, null, point(NaN, 1), point(1, Infinity), point('1', 1)]) {
    assert.equal(segmentMatchesMarquee(bad, point(1, 1), crossingBox), false);
    assert.equal(segmentMatchesMarquee(point(1, 1), bad, windowBox), false);
  }
  for (const bad of [null, {}, { ...crossingBox, x1: NaN }, { ...windowBox, y2: Infinity }]) {
    assert.equal(segmentMatchesMarquee(point(1, 1), point(2, 2), bad), false);
  }
});

test('member queries honor visibility, type/section filters and layer selection locks', () => {
  const state = new AppState();
  const a = state.addNode(-5, 5), b = state.addNode(15, 5);
  const first = state.addMember(a.id, b.id, { levelId: 'L0', type: 'beam' });
  const second = state.addMember(a.id, b.id, { levelId: 'L1', type: 'beam' });
  state.settings.planLayerDisplayMode = 'all';
  state.settings.planLayerSelectionLock = false;
  assert.deepEqual(memberIdsInMarquee(state, crossingBox), [first.id, second.id]);
  state.settings.planLayerDisplayMode = 'halftone';
  state.settings.planLayerSelectionLock = true;
  assert.deepEqual(memberIdsInMarquee(state, crossingBox), [first.id]);
  state.settings.planLayerSelectionLock = false;
  state.settings.planLayerDisplayMode = 'current';
  assert.deepEqual(memberIdsInMarquee(state, crossingBox), [first.id]);
  for (const setting of [{ showMembers: false }, { memberTypeFilter: 'column' }, { sectionFilter: 'missing' }]) {
    const before = { ...state.settings };
    Object.assign(state.settings, setting);
    assert.deepEqual(memberIdsInMarquee(state, crossingBox), []);
    Object.assign(state.settings, before);
  }
  state.members.push({ id: 'broken', startNodeId: 'missing', endNodeId: b.id, type: 'beam', levelId: 'L0' });
  assert.deepEqual(memberIdsInMarquee(state, crossingBox), [first.id]);
});

test('marquee replaces or adds selection without consuming history, revision or redo', () => {
  const { state, manager, history } = toolHarness();
  const a = state.addNode(-5, 5), b = state.addNode(15, 5), c = state.addNode(1, 1), d = state.addNode(9, 9);
  const spanning = state.addMember(a.id, b.id), enclosed = state.addMember(c.id, d.id);
  history.save(); state.addNode(100, 100); history.undo();
  const revision = state.revision, model = state.toJSON();
  const drag = (box, additive = false) => {
    manager._marqueeStart = point(box.x1, box.y1);
    manager._marqueeAdditive = additive;
    manager._selectMove(point(box.x2, box.y2));
    assert.deepEqual(manager.canvas2d.marquee, box);
    manager._selectUp(point(box.x2, box.y2));
    assert.equal(manager.canvas2d.marquee, null);
    assert.equal(manager._marqueeStart, null);
  };
  drag(crossingBox);
  assert.deepEqual(state.selectedMemberIds, [spanning.id, enclosed.id]);
  drag(windowBox);
  assert.deepEqual(state.selectedMemberIds, [enclosed.id]);
  drag(crossingBox, true);
  assert.deepEqual(state.selectedMemberIds, [enclosed.id, spanning.id]);
  drag(crossingBox, true);
  assert.deepEqual(state.selectedMemberIds, [enclosed.id, spanning.id]);
  assert.equal(state.revision, revision);
  assert.deepEqual(state.toJSON(), model);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);
});

test('clicks below the drag threshold preserve additive selection or clear exclusive selection', () => {
  const { state, manager } = toolHarness();
  const a = state.addNode(0, 0), b = state.addNode(10, 0), member = state.addMember(a.id, b.id);
  state.selectMembers([member.id]);
  for (const additive of [true, false]) {
    manager._marqueeStart = point(20, 20);
    manager._marqueeAdditive = additive;
    manager._selectUp(point(19, 20));
    assert.deepEqual(state.selectedMemberIds, additive ? [member.id] : []);
  }
});

test('marquee preview distinguishes contained selection from crossing by color and line pattern', () => {
  const canvas = Object.assign(Object.create(Canvas2D.prototype), { worldToScreen: (x, y) => ({ x, y }) });
  const ctx = {
    save() {}, restore() {}, beginPath() {}, fill() {}, stroke() {},
    rect(...args) { this.rectangle = args; }, setLineDash(dash) { this.dash = dash; },
  };
  for (const [box, color, dash] of [[windowBox, '#3b82f6', []], [crossingBox, '#22c55e', [5, 3]]]) {
    canvas.marquee = box;
    canvas._drawMarquee(ctx);
    assert.equal(ctx.strokeStyle, color);
    assert.deepEqual(ctx.dash, dash);
    assert.deepEqual(ctx.rectangle, [0, 0, 10, 10]);
  }
});
