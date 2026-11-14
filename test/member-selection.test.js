import test from 'node:test';
import assert from 'node:assert/strict';
import { allSelectableMemberIds, connectedMemberIds, invertedMemberIds } from '../js/domain/member-selection.js';
import { buildSampleModel } from '../js/samples.js';
import { AppState } from '../js/state.js';
import { applyMemberSelectionCommand } from '../js/tools/selection.js';
import { toolHarness } from './helpers/ui-harness.js';

const always = () => true;

test('pure rules: all, invert and connected walk only selectable members', () => {
  const members = [{ id: 1, k: ['a', 'b'] }, { id: 2, k: ['b', 'c'] }, { id: 3, k: ['c', 'd'] }, { id: 4, k: ['x', 'y'] }];
  const keys = member => member.k;
  assert.deepEqual(allSelectableMemberIds(members, always), [1, 2, 3, 4]);
  assert.deepEqual(invertedMemberIds(members, [2, 99], always), [1, 3, 4]);
  assert.deepEqual(connectedMemberIds(members, [3], { isSelectable: always, endpointKeys: keys }), [1, 2, 3]);
  // A hidden member neither joins the result nor bridges its neighbours.
  const hidden2 = member => member.id !== 2;
  assert.deepEqual(connectedMemberIds(members, [1], { isSelectable: hidden2, endpointKeys: keys }), [1]);
  assert.deepEqual(invertedMemberIds(members, [1], hidden2), [3, 4]);
  // Unselectable or unknown seeds are ignored; result keeps model order.
  assert.deepEqual(connectedMemberIds(members, [2, 'missing'], { isSelectable: hidden2, endpointKeys: keys }), []);
  assert.deepEqual(connectedMemberIds(members, [4, 1], { isSelectable: always, endpointKeys: keys }), [1, 2, 3, 4]);
  assert.deepEqual(allSelectableMemberIds(null, always), []);
});

test('distinct node IDs at one position connect, as in the analysis export (sample and level copy)', () => {
  const state = new AppState();
  state.loadJSON(buildSampleModel('twoStoryFrame'));
  state.settings.planLayerDisplayMode = 'all';
  state.settings.planLayerSelectionLock = false;
  const columns = state.members.filter(member => member.type === 'column');
  assert.ok(columns.length >= 2);
  for (const column of columns) {
    state.select('member', column.id);
    assert.equal(applyMemberSelectionCommand(state, 'connected').ids.length, state.members.length, column.id);
  }

  const { state: copied } = toolHarness();
  copied.levels.push({ id: 'L2', name: '3F', z: 6000 });
  copied.settings.planLayerDisplayMode = 'all';
  const a = copied.addNode(0, 0), b = copied.addNode(5000, 0);
  const column = copied.addMember(a.id, a.id, { type: 'column', levelId: 'L0', topLevelId: 'L1' });
  copied.addMember(a.id, b.id, { type: 'beam', levelId: 'L1' });
  // Same position, different node IDs, and an end 0.05 mm away still joins.
  const a2 = copied.addNode(0, 0), c = copied.addNode(0.05, 0), d = copied.addNode(0, 4000);
  const beam = copied.addMember(a2.id, d.id, { type: 'beam', levelId: 'L1' });
  const near = copied.addMember(c.id, b.id, { type: 'beam', levelId: 'L0' });
  const far = copied.addNode(0.2, 0);
  const apart = copied.addMember(far.id, d.id, { type: 'beam', levelId: 'L0' });
  copied.select('member', column.id);
  const ids = applyMemberSelectionCommand(copied, 'connected').ids;
  assert.ok(ids.includes(beam.id) && ids.includes(near.id));
  assert.ok(!ids.includes(apart.id));
});

function frame() {
  const harness = toolHarness();
  const { state } = harness;
  state.levels.push({ id: 'L2', name: '3F', z: 6000 });
  state.settings.planLayerDisplayMode = 'all';
  state.settings.planLayerSelectionLock = false;
  const a = state.addNode(0, 0), b = state.addNode(6000, 0), c = state.addNode(12000, 0), far = state.addNode(0, 9000);
  const beam0 = state.addMember(a.id, b.id, { type: 'beam', levelId: 'L0' });
  const beam0b = state.addMember(b.id, c.id, { type: 'beam', levelId: 'L0' });
  // Same plan nodes on 2F: only linked to GL through the column.
  const beam1 = state.addMember(a.id, b.id, { type: 'beam', levelId: 'L1' });
  const column = state.addMember(c.id, c.id, { type: 'column', levelId: 'L0', topLevelId: 'L1' });
  const beam2 = state.addMember(a.id, b.id, { type: 'beam', levelId: 'L2' });
  const lone = state.addMember(far.id, a.id, { type: 'beam', levelId: 'L2' });
  const beam1c = state.addMember(b.id, c.id, { type: 'beam', levelId: 'L1' });
  return { ...harness, nodes: { a, b, c, far }, members: { beam0, beam0b, beam1, column, beam2, lone, beam1c } };
}

test('connected selection follows elevations: shared plan nodes do not join floors without a column', () => {
  const { state, members: m } = frame();
  state.select('member', m.beam0.id);
  let result = applyMemberSelectionCommand(state, 'connected');
  assert.equal(result.ok, true);
  assert.deepEqual(result.ids, [m.beam0.id, m.beam0b.id, m.beam1.id, m.column.id, m.beam1c.id]);
  assert.deepEqual(state.selectedMemberIds, result.ids);
  assert.equal(state.selectedMemberId, null);

  state.select('member', m.beam2.id);
  result = applyMemberSelectionCommand(state, 'connected');
  assert.deepEqual(result.ids, [m.beam2.id, m.lone.id]);

  // Hiding the column breaks the path between GL and 2F.
  state.settings.memberTypeFilter = 'beam';
  state.select('member', m.beam0.id);
  result = applyMemberSelectionCommand(state, 'connected');
  assert.deepEqual(result.ids, [m.beam0.id, m.beam0b.id]);
});

test('cross vertical braces connect both diagonals; explicit 3D ends use their own Z', () => {
  const { state } = toolHarness();
  const a = state.addNode(0, 0), b = state.addNode(6000, 0), d = state.addNode(0, 6000);
  const brace = state.addMember(a.id, b.id, { type: 'vbrace', levelId: 'L0', topLevelId: 'L1', bracePattern: 'cross' });
  const topAtA = state.addMember(a.id, d.id, { type: 'beam', levelId: 'L1' });
  const roof = state.addMember(d.id, b.id, { type: 'beam', levelId: 'L1', geometryMode: 'explicit3d', startZ: 4000, endZ: 2800 });
  state.select('member', brace.id);
  assert.deepEqual(applyMemberSelectionCommand(state, 'connected').ids, [brace.id, topAtA.id, roof.id]);
  // The explicit 3D member starts at Z=4000, so it does not link topAtA at node d;
  // a single brace no longer reaches node a at the top level.
  state.select('member', topAtA.id);
  state.updateMember(brace.id, { bracePattern: 'single' });
  assert.equal(state.getMember(brace.id).bracePattern, 'single');
  assert.deepEqual(applyMemberSelectionCommand(state, 'connected').ids, [topAtA.id]);
});

test('select all and invert honor layer lock; commands never touch model, revision or history', () => {
  const { state, history, members: m } = frame();
  history.save(); state.addNode(1, 1); history.undo();
  const revision = state.revision, model = JSON.stringify(state.toJSON());
  assert.deepEqual(applyMemberSelectionCommand(state, 'all').ids, state.members.map(member => member.id));
  const settings = { ...state.settings };

  state.settings.planLayerDisplayMode = 'current';
  state.activeLevelId = 'L2';
  assert.deepEqual(applyMemberSelectionCommand(state, 'all').ids, [m.beam2.id, m.lone.id]);
  state.select('member', m.beam2.id);
  assert.deepEqual(applyMemberSelectionCommand(state, 'invert').ids, [m.lone.id]);
  assert.deepEqual(applyMemberSelectionCommand(state, 'invert').ids, [m.beam2.id]);
  assert.equal(state.selectedMemberId, m.beam2.id);
  state.selectMembers([m.beam2.id, m.lone.id]);
  assert.deepEqual(applyMemberSelectionCommand(state, 'invert').ids, []);

  Object.assign(state.settings, settings);
  assert.equal(state.revision, revision);
  assert.equal(JSON.stringify(state.toJSON()), model);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);
});

test('commands report why the selection is kept', () => {
  const { state, manager, members: m } = frame();
  const reports = [];
  manager.callbacks = { onMemberSelectionCommand: (...args) => reports.push(args) };
  let updates = 0;
  manager.onUpdate = () => { updates++; };
  state.select('surface', 'any');
  assert.deepEqual(manager.runMemberSelectionCommand('connected'), { ok: false, reason: 'noMemberSelected' });
  assert.equal(state.selectedSurfaceId, 'any');
  // A surface selection counts as no selected members, so invert selects all.
  assert.equal(manager.runMemberSelectionCommand('invert').ids.length, Object.keys(m).length);
  state.settings.showMembers = false;
  state.select('member', m.beam0.id);
  assert.deepEqual(manager.runMemberSelectionCommand('all'), { ok: false, reason: 'noSelectableMembers' });
  assert.deepEqual(manager.runMemberSelectionCommand('invert'), { ok: false, reason: 'noSelectableMembers' });
  assert.deepEqual(manager.runMemberSelectionCommand('connected'), { ok: false, reason: 'noMemberSelected' });
  assert.equal(state.selectedMemberId, m.beam0.id);
  assert.deepEqual(applyMemberSelectionCommand(state, 'bogus'), { ok: false, reason: 'unknown' });
  assert.equal(updates, 1);
  assert.deepEqual(reports.map(([command, result, source]) => [command, result.ok, source]),
    [['connected', false, 'menu'], ['invert', true, 'menu'], ['all', false, 'menu'], ['invert', false, 'menu'], ['connected', false, 'menu']]);
});

test('a successful command disarms split-point mode; a failed one keeps it', () => {
  const { state, manager, members: m } = frame();
  manager.callbacks = {};
  state.select('member', m.beam0.id);
  manager._splitPointMemberId = m.beam0.id;
  manager._splitPointPreviousTool = 'select';
  state.currentTool = 'splitPoint';
  state.settings.showMembers = false;
  manager.runMemberSelectionCommand('all');
  assert.equal(state.currentTool, 'splitPoint');
  state.settings.showMembers = true;
  manager.runMemberSelectionCommand('connected');
  assert.equal(state.currentTool, 'select');
  assert.equal(manager._splitPointMemberId, null);
  assert.ok(state.selectedMemberIds.length > 1);
});

test('Ctrl/Cmd+A selects all in the plan view only and leaves blocked targets alone', () => {
  const { state, manager, members: m } = frame();
  manager.canvas2d.canvas = { hidden: false };
  const sources = [];
  manager.callbacks = { onMemberSelectionCommand: (command, result, source) => sources.push(source) };
  const press = (props = {}) => {
    const event = { key: 'a', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, target: null,
      defaultPrevented: false, preventDefault() { this.defaultPrevented = true; this.prevented = true; }, ...props };
    manager._onKeyDown(event);
    return event;
  };
  assert.equal(press().prevented, true);
  assert.equal(state.selectedMemberIds.length, Object.keys(m).length);
  state.clearSelection();
  assert.equal(press({ key: 'A', ctrlKey: false, metaKey: true }).prevented, true);
  assert.equal(state.selectedMemberIds.length, Object.keys(m).length);
  state.clearSelection();
  for (const props of [{ target: { tagName: 'INPUT' } }, { isComposing: true }, { shiftKey: true }, { altKey: true }]) {
    assert.equal(press(props).prevented, undefined, JSON.stringify(props));
  }
  manager.canvas2d.canvas.hidden = true;
  assert.equal(press().prevented, undefined);
  assert.deepEqual(state.selectedMemberIds, []);
  assert.deepEqual(sources, ['shortcut', 'shortcut']);
});
