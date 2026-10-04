import test from 'node:test';
import assert from 'node:assert/strict';
import { AppState } from '../js/state.js';
import { History } from '../js/history.js';
import { queryElements } from '../js/domain/element-query.js';
import { focusMembers } from '../js/ui/focus-issue.js';

test('element queries combine exact member filters with case-insensitive ID/section search', () => {
  const state = { members: [
    { id: 'M1', type: 'beam', levelId: 'L0', sectionName: 'B300' },
    { id: 'M2', type: 'beam', levelId: 'L1', sectionName: 'B300' },
    { id: 'M3', type: 'beam', levelId: 'L0', sectionName: 'B300x' },
    { id: 'M4', type: 'column', levelId: 'L0', sectionName: 'B300' },
  ], surfaces: [{ id: 'S1', levelId: 'L0' }], loads: [], supports: [] };
  const before = structuredClone(state);
  const filters = { kind: 'member', levelId: 'L0', memberType: 'beam', sectionName: 'B300', search: ' b3 ' };
  const matches = queryElements(state, filters);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].item, state.members[0]);
  assert.equal(matches[0].elementType, 'member');
  assert.equal(queryElements(state, { ...filters, search: ' M1 ' }).length, 1);
  assert.deepEqual(queryElements(state, { ...filters, search: 'missing' }), []);
  assert.deepEqual(state, before);
  assert.equal(queryElements(state, { kind: 'all', memberType: 'beam', sectionName: 'B300' }).length, 5);
  assert.equal(queryElements(state, { kind: 'surface', memberType: 'beam', sectionName: 'B300' })[0].item.id, 'S1');
});

test('queries distinguish numeric and string level IDs and include matches beyond one page', () => {
  const state = { members: Array.from({ length: 125 }, (_, id) =>
    ({ id, type: 'beam', levelId: id % 2 ? '1' : 1, sectionName: '_G' })), surfaces: [], loads: [], supports: [] };
  assert.equal(queryElements(state, { kind: 'member' }).length, 125);
  const numeric = queryElements(state, { levelId: 1 });
  assert.equal(numeric.length, 63);
  assert.equal(numeric[0].item.id, 0);
  assert.equal(queryElements(state, { levelId: '1' }).length, 62);
});

test('bulk focus replaces selection, reveals every level and preserves geometry and redo', () => {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(6000, 4000);
  const first = state.addMember(a.id, b.id, { levelId: 'L0' });
  const second = state.addMember(a.id, b.id, { levelId: 'L1' });
  const history = new History(state);
  history.save(); state.addNode(8000, 6000); history.undo();
  state.select('support', 'stale');
  state.updateSetting('showMembers', false);
  state.updateSetting('memberTypeFilter', 'column');
  state.updateSetting('sectionFilter', 'other');
  state.updateSetting('planLayerDisplayMode', 'halftone');
  state.updateSetting('planLayerSelectionLock', true);
  const members = structuredClone(state.members), nodes = structuredClone(state.nodes);
  const canvas = { camera: {}, logicalWidth: 800, logicalHeight: 500 };
  assert.equal(focusMembers(state, canvas, [first.id, 'stale', second.id, first.id]), true);
  assert.deepEqual(state.selectedMemberIds, [first.id, second.id]);
  assert.equal(state.selectedSupportId, null);
  assert.equal(state.settings.planLayerDisplayMode, 'all');
  assert.equal(state.members.every(item => state.isMemberSelectable(item)), true);
  assert.equal(state.activeLevelId, 'L0');
  assert.equal(state.currentTool, 'select');
  assert.deepEqual(state.members, members);
  assert.deepEqual(state.nodes, nodes);
  assert.equal(history.undoStack.length, 0);
  assert.equal(history.redoStack.length, 1);
  assert.equal(3000 * canvas.camera.scale + canvas.camera.offsetX, 400);
  assert.equal(canvas.camera.offsetY - 2000 * canvas.camera.scale, 250);
});

test('empty bulk focus leaves selection and view untouched; a single level retains its display mode', () => {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(1000, 0);
  const member = state.addMember(a.id, b.id, { levelId: 'L1' });
  state.select('member', member.id);
  state.updateSetting('planLayerDisplayMode', 'current');
  const camera = { scale: 0.5, offsetX: 10, offsetY: 20 };
  const canvas = { camera: { ...camera } };
  const revision = state.revision;
  assert.equal(focusMembers(state, canvas, ['missing']), false);
  assert.equal(state.selectedMemberId, member.id);
  assert.equal(state.revision, revision);
  assert.deepEqual(canvas.camera, camera);
  assert.equal(focusMembers(state, canvas, [member.id]), true);
  assert.equal(state.settings.planLayerDisplayMode, 'current');
  assert.equal(state.isMemberSelectable(state.getMember(member.id)), true);
});
