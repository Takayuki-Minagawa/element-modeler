import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { AppState } from '../js/state.js';
import { CURRENT_SCHEMA_VERSION } from '../js/serialization.js';
import {
  computeMemberLengthM,
  computeMemberSchedule,
  computeQuantitySummary,
  computeRoofMemberSummary,
  computeSurfaceWeightAreaM2,
  computeSurfaceWindProjectionM2,
  resolveSurfaceVerticalRange,
} from '../js/quantities.js';

test('wall height modes resolve to partial vertical ranges', () => {
  const state = new AppState();

  const waist = state.addSurfaceLine(0, 0, 5000, 0, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'waist',
  });
  const hanging = state.addSurfaceLine(0, 1000, 5000, 1000, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'hanging',
  });

  assert.deepEqual(resolveSurfaceVerticalRange(state, waist), {
    bottom: 0,
    top: 1200,
    height: 1200,
    bottomOffset: 0,
    topOffset: 1200,
  });
  assert.equal(resolveSurfaceVerticalRange(state, hanging).bottom, 2200);
  assert.equal(resolveSurfaceVerticalRange(state, hanging).top, 2800);
});

test('wall height and weight fields survive CAD serialization', () => {
  const source = new AppState();
  source.addSurfaceLine(0, 0, 5000, 0, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'custom',
    bottomOffset: 300,
    topOffset: 1800,
    includeWind: false,
    includeSeismicWeight: true,
    unitWeight: 450,
  });

  const data = source.toJSON();
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(data.surfaces[0].heightMode, 'custom');
  assert.equal(data.surfaces[0].bottomOffset, 300);
  assert.equal(data.surfaces[0].topOffset, 1800);
  assert.equal(data.surfaces[0].includeWind, false);
  assert.equal(data.surfaces[0].includeSeismicWeight, true);
  assert.equal(data.surfaces[0].unitWeight, 450);

  const restored = new AppState();
  restored.loadJSON(data);
  assert.equal(restored.surfaces[0].heightMode, 'custom');
  assert.equal(restored.surfaces[0].bottomOffset, 300);
  assert.equal(restored.surfaces[0].topOffset, 1800);
  assert.equal(restored.surfaces[0].includeWind, false);
  assert.equal(restored.surfaces[0].includeSeismicWeight, true);
  assert.equal(restored.surfaces[0].unitWeight, 450);
});

test('roof plane fields survive CAD serialization', () => {
  const source = new AppState();
  source.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.25,
    roofDirection: 'yMinus',
    roofBaseOffset: 900,
    roofGroupId: 'MainRoof',
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 700,
  });

  const data = source.toJSON();
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(data.surfaces[0].type, 'roof');
  assert.equal(data.surfaces[0].roofSlope, 0.25);
  assert.equal(data.surfaces[0].roofDirection, 'yMinus');
  assert.equal(data.surfaces[0].roofBaseOffset, 900);
  assert.equal(data.surfaces[0].roofGroupId, 'MainRoof');

  const restored = new AppState();
  restored.loadJSON(data);
  assert.equal(restored.surfaces[0].sectionName, '_R');
  assert.equal(restored.surfaces[0].color, '#8b6f47');
  assert.equal(restored.surfaces[0].roofSlope, 0.25);
  assert.equal(restored.surfaces[0].roofDirection, 'yMinus');
  assert.equal(restored.surfaces[0].roofBaseOffset, 900);
  assert.equal(restored.surfaces[0].roofGroupId, 'MainRoof');
  assert.equal(restored.surfaces[0].includeWind, true);
  assert.equal(restored.surfaces[0].includeSeismicWeight, true);
});

test('roof group ids default, serialize, and list by group', () => {
  const source = new AppState();
  const a = source.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofGroupId: 'A',
  });
  source.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofGroupId: 'A',
  });
  source.addSurfaceRect(0, 5000, 5000, 9000, {
    type: 'roof',
    levelId: 'L1',
    roofGroupId: 'B',
  });
  source.addSurfaceRect(0, 10000, 5000, 14000, {
    type: 'roof',
    levelId: 'L1',
    roofGroupId: '',
  });

  assert.equal(a.roofGroupId, 'A');
  assert.deepEqual(source.listRoofGroups().map(group => [group.id, group.surfaces.length]), [
    ['A', 2],
    ['B', 1],
    ['RG1', 1],
  ]);

  const data = source.toJSON();
  assert.equal(data.surfaces[0].roofGroupId, 'A');
  assert.equal(data.surfaces[3].roofGroupId, 'RG1');

  const restored = new AppState();
  restored.loadJSON({
    ...data,
    schemaVersion: 6,
    surfaces: data.surfaces.map(({ roofGroupId, ...surface }) => surface),
  });
  assert.equal(restored.surfaces[0].roofGroupId, 'RG1');
  assert.equal(restored.getRoofGroupSurfaces('RG1').length, 4);
});

test('roof planes can be generated from a rectangular source outline', () => {
  const state = new AppState();
  const floor = state.addSurfaceRect(0, 0, 10000, 4000, {
    type: 'floor',
    levelId: 'L0',
    topLevelId: 'L1',
  });

  const roofs = state.addRoofPlanesFromSurface(floor.id, {
    pattern: 'gableX',
    roofGroupId: 'Auto',
    roofSlope: 0.3,
    roofBaseOffset: 200,
  });

  assert.equal(roofs.length, 2);
  assert.deepEqual(roofs.map(surface => surface.roofDirection), ['xPlus', 'xMinus']);
  assert.ok(roofs.every(surface => surface.type === 'roof'));
  assert.ok(roofs.every(surface => surface.levelId === 'L1'));
  assert.ok(roofs.every(surface => surface.roofGroupId === 'Auto'));
  assert.deepEqual(roofs[0].points, [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 0, y: 4000 },
  ]);

  const joints = state.addRoofJointMembers('Auto');
  assert.equal(joints.length, 1);
  assert.equal(joints[0].roofRole, 'roofRidge');
  assert.equal(joints[0].startZ, 4500);
  assert.equal(joints[0].endZ, 4500);
});

test('hip roof planes can be generated from the source outline', () => {
  const state = new AppState();
  const floor = state.addSurfaceRect(0, 0, 10000, 4000, {
    type: 'floor',
    levelId: 'L0',
    topLevelId: 'L1',
  });

  const roofs = state.addRoofPlanesFromSurface(floor.id, {
    pattern: 'hip',
    roofGroupId: 'Hip',
    roofSlope: 0.25,
  });

  assert.equal(roofs.length, 4);
  assert.deepEqual(roofs.map(surface => surface.roofDirection), ['yPlus', 'xMinus', 'yMinus', 'xPlus']);
  assert.deepEqual(roofs.map(surface => surface.points.length), [4, 3, 4, 3]);
  assert.deepEqual(roofs[0].points.slice(2), [
    { x: 8000, y: 2000 },
    { x: 2000, y: 2000 },
  ]);
  assert.ok(roofs.every(surface => surface.roofGroupId === 'Hip'));
});

test('non-rectangular outlines generate single roof planes but skip split presets', () => {
  const state = new AppState();
  const source = state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 2000 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 5000 },
    { x: 0, y: 5000 },
  ], {
    type: 'floor',
    levelId: 'L0',
    topLevelId: 'L1',
  });

  const split = state.addRoofPlanesFromSurface(source.id, { pattern: 'gableX', roofGroupId: 'Split' });
  const single = state.addRoofPlanesFromSurface(source.id, {
    pattern: 'single',
    roofGroupId: 'Single',
    roofDirection: 'yPlus',
  });

  assert.equal(split.length, 0);
  assert.equal(single.length, 1);
  assert.equal(single[0].roofDirection, 'yPlus');
  assert.equal(single[0].points.length, 6);
});

test('eave surfaces use sloped geometry without roof grouping', () => {
  const source = new AppState();
  const eave = source.addSurfaceRect(0, 0, 3000, 1000, {
    type: 'eave',
    levelId: 'L1',
    roofSlope: 0.2,
    roofDirection: 'yPlus',
    roofBaseOffset: -300,
    roofGroupId: 'Ignored',
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 250,
  });

  assert.equal(eave.sectionName, '_E');
  assert.equal(eave.roofGroupId, undefined);
  assert.equal(Number(computeSurfaceWeightAreaM2(source, eave).toFixed(3)), 3.059);
  assert.deepEqual(computeSurfaceWindProjectionM2(source, eave), {
    xAreaM2: 0,
    yAreaM2: 0.6,
  });

  const data = source.toJSON();
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(data.surfaces[0].type, 'eave');
  assert.equal(data.surfaces[0].roofSlope, 0.2);
  assert.equal(data.surfaces[0].roofDirection, 'yPlus');
  assert.equal(data.surfaces[0].roofBaseOffset, -300);
  assert.equal(Object.hasOwn(data.surfaces[0], 'roofGroupId'), false);

  const restored = new AppState();
  restored.loadJSON(data);
  assert.equal(restored.surfaces[0].type, 'eave');
  assert.equal(restored.surfaces[0].sectionName, '_E');
  assert.equal(restored.surfaces[0].roofSlope, 0.2);
  assert.equal(restored.surfaces[0].roofDirection, 'yPlus');
  assert.equal(restored.surfaces[0].includeWind, true);
  assert.equal(restored.surfaces[0].includeSeismicWeight, true);
});

test('non-roof surfaces omit roof-only fields', () => {
  const source = new AppState();
  source.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'floor',
    levelId: 'L1',
    includeSeismicWeight: true,
    unitWeight: 300,
  });

  const data = source.toJSON();
  assert.equal(Object.hasOwn(data.surfaces[0], 'roofSlope'), false);
  assert.equal(Object.hasOwn(data.surfaces[0], 'roofDirection'), false);
  assert.equal(Object.hasOwn(data.surfaces[0], 'roofBaseOffset'), false);
  assert.equal(Object.hasOwn(data.surfaces[0], 'roofGroupId'), false);

  const restored = new AppState();
  restored.loadJSON({
    ...data,
    surfaces: [{
      ...data.surfaces[0],
      roofSlope: null,
      roofDirection: null,
      roofBaseOffset: null,
      roofGroupId: null,
    }],
  });

  assert.equal(Object.hasOwn(restored.surfaces[0], 'roofSlope'), false);
  assert.equal(Object.hasOwn(restored.toJSON().surfaces[0], 'roofSlope'), false);
  assert.equal(Object.hasOwn(restored.toJSON().surfaces[0], 'roofGroupId'), false);
});

test('gable wall surfaces use trapezoid area and variable top offsets', () => {
  const source = new AppState();
  const gable = source.addSurfaceLine(0, 0, 5000, 0, {
    type: 'gableWall',
    levelId: 'L0',
    topLevelId: 'L1',
    bottomOffset: 0,
    topOffset: 2800,
    gableStartTopOffset: 1200,
    gableEndTopOffset: 2800,
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 400,
  });

  assert.equal(gable.sectionName, '_GW');
  assert.equal(gable.heightMode, 'custom');
  assert.equal(gable.topOffset, 2800);
  assert.equal(computeSurfaceWeightAreaM2(source, gable), 10);
  assert.deepEqual(computeSurfaceWindProjectionM2(source, gable), {
    xAreaM2: 0,
    yAreaM2: 10,
  });

  const data = source.toJSON();
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(data.surfaces[0].type, 'gableWall');
  assert.equal(data.surfaces[0].gableStartTopOffset, 1200);
  assert.equal(data.surfaces[0].gableEndTopOffset, 2800);

  const restored = new AppState();
  restored.loadJSON(data);
  assert.equal(restored.surfaces[0].type, 'gableWall');
  assert.equal(restored.surfaces[0].sectionName, '_GW');
  assert.equal(restored.surfaces[0].gableStartTopOffset, 1200);
  assert.equal(restored.surfaces[0].gableEndTopOffset, 2800);
  assert.equal(computeQuantitySummary(restored).totals.seismicWeightN, 4000);
});

test('invalid custom wall offsets are rejected instead of being clamped to 1mm height', () => {
  const state = new AppState();
  const wall = state.addSurfaceLine(0, 0, 5000, 0, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'custom',
    bottomOffset: 0,
    topOffset: 1200,
  });

  state.updateSurface(wall.id, { bottomOffset: 1500 });
  assert.equal(wall.bottomOffset, 0);
  assert.equal(wall.topOffset, 1200);
  assert.equal(wall.heightMode, 'custom');

  state.updateSurface(wall.id, { topOffset: -100 });
  assert.equal(wall.bottomOffset, 0);
  assert.equal(wall.topOffset, 1200);
});

test('floor surfaces keep wall-only height and wind fields inert', () => {
  const state = new AppState();
  const floor = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'floor',
    levelId: 'L0',
    heightMode: 'waist',
    bottomOffset: 300,
    topOffset: 1200,
  });

  assert.equal(floor.heightMode, 'custom');
  assert.equal(floor.bottomOffset, 0);
  assert.equal(floor.topOffset, 0);
  assert.equal(floor.includeWind, false);
});

test('wind projection uses direction-specific projected areas', () => {
  const state = new AppState();
  const wall = state.addSurfaceLine(0, 0, 5000, 0, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'waist',
  });
  const exterior = state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 0, y: 4000 },
  ], {
    type: 'exteriorWall',
    levelId: 'L0',
    topLevelId: 'L1',
  });

  assert.deepEqual(computeSurfaceWindProjectionM2(state, wall), {
    xAreaM2: 0,
    yAreaM2: 6,
  });
  assert.deepEqual(computeSurfaceWindProjectionM2(state, exterior), {
    xAreaM2: 11.2,
    yAreaM2: 14,
  });

  const rectExterior = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'exteriorWall',
    levelId: 'L0',
    topLevelId: 'L1',
  });
  assert.deepEqual(computeSurfaceWindProjectionM2(state, rectExterior), {
    xAreaM2: 11.2,
    yAreaM2: 14,
  });
});

test('exterior wall polygon wind projection uses the segment silhouette once per axis', async () => {
  const state = new AppState();
  const reentrant = state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 6000, y: 0 },
    { x: 6000, y: 2000 },
    { x: 3000, y: 2000 },
    { x: 3000, y: 5000 },
    { x: 0, y: 5000 },
  ], {
    type: 'exteriorWall',
    levelId: 'L0',
    topLevelId: 'L1',
  });

  assert.deepEqual(computeSurfaceWindProjectionM2(state, reentrant), {
    xAreaM2: 14,
    yAreaM2: 16.8,
  });

  const quantitiesSource = await readFile(new URL('../js/quantities.js', import.meta.url), 'utf8');
  assert.match(quantitiesSource, /computeExteriorWallWindProjectionM2/);
  assert.match(quantitiesSource, /projectedSegmentUnionLengthMm\(segments,\s*'y'\)/);
  assert.match(quantitiesSource, /projectedSegmentUnionLengthMm\(segments,\s*'x'\)/);
  assert.doesNotMatch(quantitiesSource, /pointBounds/);
});

test('seismic weight summary uses surface area times unit weight', () => {
  const state = new AppState();
  const floor = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'floor',
    levelId: 'L0',
    includeSeismicWeight: true,
    unitWeight: 600,
  });
  const wall = state.addSurfaceLine(0, 0, 5000, 0, {
    type: 'wall',
    levelId: 'L0',
    topLevelId: 'L1',
    heightMode: 'waist',
    includeSeismicWeight: true,
    unitWeight: 500,
  });

  assert.equal(computeSurfaceWeightAreaM2(state, floor), 20);
  assert.equal(computeSurfaceWeightAreaM2(state, wall), 6);

  const summary = computeQuantitySummary(state);
  assert.equal(summary.totals.seismicWeightN, 15000);
  assert.equal(summary.totals.windYAreaM2, 6);
});

test('roof planes use sloped actual area and vertical projected wind areas', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    includeWind: true,
    includeSeismicWeight: true,
    unitWeight: 500,
  });

  assert.equal(Number(computeSurfaceWeightAreaM2(state, roof).toFixed(3)), 20.881);
  assert.deepEqual(computeSurfaceWindProjectionM2(state, roof), {
    xAreaM2: 6,
    yAreaM2: 0,
  });

  const summary = computeQuantitySummary(state);
  assert.equal(Number(summary.totals.seismicWeightN.toFixed(3)), 10440.307);
  assert.equal(summary.totals.windXAreaM2, 6);
});

test('roof edge members are generated with explicit 3D endpoints', () => {
  const state = new AppState();
  const existingCorner = state.addNode(0, 0);
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofBaseOffset: 200,
  });

  const members = state.addRoofEdgeMembers(roof.id);
  assert.equal(members.length, 4);
  assert.equal(state.nodes.length, 4);
  assert.equal(members[0].startNodeId, existingCorner.id);
  const connectedNodeIds = new Set(members.flatMap(member => [member.startNodeId, member.endNodeId]));
  assert.equal(connectedNodeIds.size, 4);
  for (const nodeId of connectedNodeIds) {
    const useCount = members.filter(member => member.startNodeId === nodeId || member.endNodeId === nodeId).length;
    assert.equal(useCount, 2);
  }
  assert.ok(members.every(member => member.geometryMode === 'explicit3d'));
  assert.ok(members.every(member => member.roofRole === 'roofEdge'));
  assert.equal(members[0].startZ, 3000);
  assert.equal(members[0].endZ, 4500);

  const data = state.toJSON();
  assert.equal(data.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(data.members[0].geometryMode, 'explicit3d');
  assert.equal(data.members[0].startZ, 3000);
  assert.equal(data.members[0].endZ, 4500);
  assert.equal(data.members[0].roofRole, 'roofEdge');

  const restored = new AppState();
  restored.loadJSON(data);
  assert.equal(restored.members[0].geometryMode, 'explicit3d');
  assert.equal(restored.members[0].startZ, 3000);
  assert.equal(restored.members[0].endZ, 4500);
});

test('roof joint members are generated from shared roof group edges', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  const members = state.addRoofJointMembers('Main');
  assert.equal(members.length, 1);
  assert.equal(members[0].roofRole, 'roofRidge');
  assert.equal(members[0].geometryMode, 'explicit3d');
  assert.equal(members[0].startZ, 4300);
  assert.equal(members[0].endZ, 4300);
  const start = state.getNode(members[0].startNodeId);
  const end = state.getNode(members[0].endNodeId);
  assert.equal(start.x, 5000);
  assert.equal(end.x, 5000);
});

test('roof joint generation classifies valleys and respects roof groups', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(10000, 0, 15000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Other',
  });

  const members = state.addRoofJointMembers('Main');
  assert.equal(members.length, 1);
  assert.equal(members[0].roofRole, 'roofValley');
  assert.equal(members[0].startZ, 2800);
  assert.equal(members[0].endZ, 2800);
});

test('roof joint generation classifies concave notch shared edges from owning interiors', () => {
  const state = new AppState();
  state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 3500, y: 4000 },
    { x: 3500, y: 1000 },
    { x: 1500, y: 1000 },
    { x: 1500, y: 4000 },
    { x: 0, y: 4000 },
  ], {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'yPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(1500, 1000, 3500, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.1,
    roofDirection: 'yMinus',
    roofGroupId: 'Main',
  });

  const members = state.addRoofJointMembers('Main');
  assert.equal(members.length, 1);
  assert.equal(members[0].roofRole, 'roofRidge');
  assert.equal(members[0].geometryMode, 'explicit3d');
  assert.equal(members[0].startZ, 3100);
  assert.equal(members[0].endZ, 3100);
});

test('roof joint classification samples inward from the shared roof edge', async () => {
  // Roof auto-generation logic was extracted from state.js into roof-generation.js
  const roofGenSource = await readFile(new URL('../js/roof-generation.js', import.meta.url), 'utf8');

  assert.match(roofGenSource, /roofInteriorSamplePoint\(surface,\s*start,\s*end\)/);
  assert.match(roofGenSource, /edgeInwardNormal\(edge\.start,\s*edge\.end,\s*points\)/);
  assert.match(roofGenSource, /isInteriorPlanPoint\(sample,\s*points,\s*0\.001\)/);
  assert.match(roofGenSource, /uniquePositiveNumbers\(\[/);
  assert.doesNotMatch(roofGenSource, /roofInteriorZDelta\(surface,\s*edgePoint,\s*edgeZ\)/);
});

test('roof edge generation skips shared roof group edges', () => {
  const state = new AppState();
  const left = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  const right = state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  const leftEdges = state.addRoofEdgeMembers(left.id);
  const rightEdges = state.addRoofEdgeMembers(right.id);
  const edgeMembers = state.members.filter(member => member.roofRole === 'roofEdge');

  assert.equal(leftEdges.length, 3);
  assert.equal(rightEdges.length, 3);
  assert.equal(edgeMembers.length, 6);
  assert.equal(edgeMembers.some(member => {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    return start.x === 5000 && end.x === 5000;
  }), false);
});

test('roof joint generation replaces duplicate roof edge members on shared edges', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });
  const start = state.addNode(5000, 0);
  const end = state.addNode(5000, 4000);
  state.addMember(start.id, end.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 4300,
    endZ: 4300,
    roofRole: 'roofEdge',
  });
  state.addMember(start.id, end.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 4300,
    endZ: 4300,
    roofRole: 'roofEdge',
  });

  const joints = state.addRoofJointMembers('Main');

  assert.equal(joints.length, 1);
  assert.equal(joints[0].roofRole, 'roofRidge');
  assert.equal(state.members.filter(member => member.roofRole === 'roofEdge').length, 0);
  assert.equal(state.members.filter(member => member.roofRole === 'roofRidge').length, 1);
});

test('roof group validation reports shared edge height mismatches and invalid outlines', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.2,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });
  state.addSurfacePolygon([
    { x: 0, y: 6000 },
    { x: 4000, y: 10000 },
    { x: 0, y: 10000 },
    { x: 4000, y: 6000 },
  ], {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.2,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });

  const result = state.validateRoofGroup('Main');

  assert.equal(result.surfaceCount, 3);
  assert.ok(result.issues.some(issue => issue.code === 'roofSharedEdgeHeightMismatch'));
  assert.ok(result.issues.some(issue => issue.code === 'roofSelfIntersection'));
});

test('generated roof elements can be removed and regenerated by roof group', () => {
  const state = new AppState();
  const left = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  const right = state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  state.addRoofEdgeMembers(left.id);
  state.addRoofEdgeMembers(right.id);
  state.addRoofJointMembers('Main');
  state.addEavesFromRoofGroup('Main', { depth: 600 });
  state.addGableWallsFromRoofGroup('Main');

  assert.equal(state.members.filter(member => member.roofRole).length, 7);
  assert.equal(state.surfaces.filter(surface => surface.type === 'eave').length, 6);
  assert.equal(state.surfaces.filter(surface => surface.type === 'gableWall').length, 4);

  const removed = state.removeRoofGeneratedElements('Main');
  assert.deepEqual(removed, { members: 7, eaves: 6, gableWalls: 4, total: 17 });
  assert.equal(state.members.filter(member => member.roofRole).length, 0);
  assert.equal(state.surfaces.filter(surface => surface.type === 'eave').length, 0);
  assert.equal(state.surfaces.filter(surface => surface.type === 'gableWall').length, 0);
  assert.equal(state.getRoofGroupSurfaces('Main').length, 2);

  const regenerated = state.regenerateRoofGeneratedElements('Main', { spacing: 1000, depth: 600 });
  assert.ok(regenerated.generated.roofEdges > 0);
  assert.ok(regenerated.generated.roofSlopeBeams > 0);
  assert.ok(regenerated.generated.roofJoints > 0);
  assert.ok(regenerated.generated.eaves > 0);
  assert.ok(regenerated.generated.gableWalls > 0);
  assert.equal(state.getRoofGroupSurfaces('Main').length, 2);
});

test('roof member summary groups counts and explicit 3D lengths by role', () => {
  const state = new AppState();
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(3000, 4000);
  const n3 = state.addNode(3000, 0);
  const n4 = state.addNode(6000, 0);

  const edge = state.addMember(n1.id, n2.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 2800,
    endZ: 2800,
    roofRole: 'roofEdge',
  });
  state.addMember(n2.id, n3.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 2800,
    endZ: 5800,
    roofRole: 'roofEdge',
  });
  state.addMember(n3.id, n4.id, {
    type: 'beam',
    levelId: 'L1',
    geometryMode: 'explicit3d',
    startZ: 2800,
    endZ: 6800,
    roofRole: 'roofRidge',
  });
  state.addMember(n1.id, n4.id, { type: 'beam', levelId: 'L1' });

  assert.equal(computeMemberLengthM(state, edge), 5);
  const summary = computeRoofMemberSummary(state);
  assert.deepEqual(summary.rows.map(row => [row.roofRole, row.count, Number(row.lengthM.toFixed(3))]), [
    ['roofEdge', 2, 10],
    ['roofRidge', 1, 5],
  ]);
  assert.equal(summary.totals.count, 3);
  assert.equal(summary.totals.lengthM, 15);
  assert.equal(computeQuantitySummary(state).roofMembers.totals.count, 3);
});

test('gable walls are generated from sloped outer roof group edges', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  const walls = state.addGableWallsFromRoofGroup('Main');

  assert.equal(walls.length, 4);
  assert.ok(walls.every(surface => surface.type === 'gableWall'));
  assert.ok(walls.every(surface => surface.sectionName === '_GW'));
  assert.equal(state.surfaces.filter(surface => surface.type === 'gableWall').length, 4);
  assert.deepEqual(walls.map(surface => [surface.x1, surface.y1, surface.x2, surface.y2, surface.gableStartTopOffset, surface.gableEndTopOffset]), [
    [0, 0, 5000, 0, 0, 1500],
    [5000, 4000, 0, 4000, 1500, 0],
    [5000, 0, 10000, 0, 1500, 0],
    [10000, 4000, 5000, 4000, 0, 1500],
  ]);

  const secondPass = state.addGableWallsFromRoofGroup('Main');
  assert.equal(secondPass.length, 0);
});

test('gable wall generation skips shared and horizontal roof edges', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  state.addGableWallsFromRoofGroup('Main');
  const gableWalls = state.surfaces.filter(surface => surface.type === 'gableWall');

  assert.equal(gableWalls.some(surface => surface.x1 === 5000 && surface.x2 === 5000), false);
  assert.equal(gableWalls.some(surface => surface.x1 === 0 && surface.x2 === 0), false);
  assert.equal(gableWalls.some(surface => surface.x1 === 10000 && surface.x2 === 10000), false);
});

test('eaves are generated from outer roof group edges and skip shared edges', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfaceRect(5000, 0, 10000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xMinus',
    roofGroupId: 'Main',
  });

  const eaves = state.addEavesFromRoofGroup('Main', { depth: 600 });

  assert.equal(eaves.length, 6);
  assert.equal(eaves.every(surface => surface.type === 'eave'), true);
  assert.equal(eaves.every(surface => !Object.hasOwn(surface, 'roofGroupId')), true);
  assert.equal(eaves.some(surface =>
    surface.points.some((point, index) => {
      const next = surface.points[(index + 1) % surface.points.length];
      return point.x === 5000 && next.x === 5000 && point.y === 0 && next.y === 4000;
    })
  ), false);
  assert.deepEqual(eaves[0].points, [
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: -600 },
    { x: 0, y: -600 },
  ]);
});

test('eave generation is idempotent for an existing roof group boundary', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });

  const first = state.addEavesFromRoofGroup('Main', { depth: 600 });
  const second = state.addEavesFromRoofGroup('Main', { depth: 600 });

  assert.equal(first.length, 4);
  assert.equal(second.length, 0);
  assert.equal(state.surfaces.filter(surface => surface.type === 'eave').length, 4);
});

test('eave dedupe only considers the generated inner edge', () => {
  const state = new AppState();
  state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofGroupId: 'Main',
  });
  state.addSurfacePolygon([
    { x: 0, y: -600 },
    { x: 5000, y: -600 },
    { x: 5000, y: 0 },
    { x: 0, y: 0 },
  ], {
    type: 'eave',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
  });

  const eaves = state.addEavesFromRoofGroup('Main', { depth: 600 });

  assert.equal(eaves.length, 4);
});

test('roof slope members are generated along the roof rise direction', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofBaseOffset: 200,
  });

  const members = state.addRoofSlopeMembers(roof.id, { spacing: 1000 });
  assert.equal(members.length, 3);
  assert.equal(state.nodes.length, 6);
  assert.ok(members.every(member => member.geometryMode === 'explicit3d'));
  assert.ok(members.every(member => member.roofRole === 'roofSlopeBeam'));

  for (const member of members) {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    assert.equal(start.x, 0);
    assert.equal(end.x, 5000);
    assert.equal(start.y, end.y);
    assert.ok([1000, 2000, 3000].includes(start.y));
    assert.equal(member.startZ, 3000);
    assert.equal(member.endZ, 4500);
  }
});

test('roof slope member endpoints split existing roof edge members for node sharing', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofBaseOffset: 200,
  });

  state.addRoofEdgeMembers(roof.id);
  const slopeMembers = state.addRoofSlopeMembers(roof.id, { spacing: 1000 });
  const edgeMembers = state.members.filter(member => member.roofRole === 'roofEdge');

  assert.equal(slopeMembers.length, 3);
  assert.equal(edgeMembers.length, 10);
  for (const member of slopeMembers) {
    for (const nodeId of [member.startNodeId, member.endNodeId]) {
      const edgeUseCount = edgeMembers.filter(edge => edge.startNodeId === nodeId || edge.endNodeId === nodeId).length;
      assert.equal(edgeUseCount, 2);
    }
  }
});

test('roof edge members split around existing roof slope endpoints', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofBaseOffset: 200,
  });

  const slopeMembers = state.addRoofSlopeMembers(roof.id, { spacing: 1000 });
  const generatedEdges = state.addRoofEdgeMembers(roof.id);
  const edgeMembers = state.members.filter(member => member.roofRole === 'roofEdge');

  assert.equal(slopeMembers.length, 3);
  assert.equal(generatedEdges.length, 10);
  assert.equal(edgeMembers.length, 10);
  for (const member of slopeMembers) {
    for (const nodeId of [member.startNodeId, member.endNodeId]) {
      const edgeUseCount = edgeMembers.filter(edge => edge.startNodeId === nodeId || edge.endNodeId === nodeId).length;
      assert.equal(edgeUseCount, 2);
    }
  }
});

test('roof edge generation does not split around unrelated boundary nodes', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 5000, 4000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.3,
    roofDirection: 'xPlus',
    roofBaseOffset: 200,
  });
  state.addNode(0, 1000);

  const generatedEdges = state.addRoofEdgeMembers(roof.id);
  const edgeMembers = state.members.filter(member => member.roofRole === 'roofEdge');

  assert.equal(generatedEdges.length, 4);
  assert.equal(edgeMembers.length, 4);
});

test('roof slope member generation falls back to a center line for narrow roofs', () => {
  const state = new AppState();
  const roof = state.addSurfaceRect(0, 0, 500, 5000, {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.2,
    roofDirection: 'yMinus',
  });

  const members = state.addRoofSlopeMembers(roof.id, { spacing: 1000 });
  assert.equal(members.length, 1);
  const start = state.getNode(members[0].startNodeId);
  const end = state.getNode(members[0].endNodeId);
  assert.equal(start.x, 250);
  assert.equal(end.x, 250);
  assert.equal(start.y, 5000);
  assert.equal(end.y, 0);
  assert.equal(members[0].startZ, 2800);
  assert.equal(members[0].endZ, 3800);
});

test('roof slope member generation splits lines through re-entrant roof plans', () => {
  const state = new AppState();
  const roof = state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 3500, y: 4000 },
    { x: 3500, y: 1000 },
    { x: 1500, y: 1000 },
    { x: 1500, y: 4000 },
    { x: 0, y: 4000 },
  ], {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.1,
    roofDirection: 'xPlus',
  });

  const members = state.addRoofSlopeMembers(roof.id, { spacing: 2000 });
  assert.equal(members.length, 2);

  const spans = members.map(member => {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    return [start.x, end.x, start.y, end.y, member.startZ, member.endZ];
  });
  assert.deepEqual(spans, [
    [0, 1500, 2000, 2000, 2800, 2950],
    [3500, 5000, 2000, 2000, 3150, 3300],
  ]);
});

test('roof slope member generation skips spans outside a re-entrant notch boundary', () => {
  const state = new AppState();
  const roof = state.addSurfacePolygon([
    { x: 0, y: 0 },
    { x: 5000, y: 0 },
    { x: 5000, y: 4000 },
    { x: 3500, y: 4000 },
    { x: 3500, y: 1000 },
    { x: 1500, y: 1000 },
    { x: 1500, y: 4000 },
    { x: 0, y: 4000 },
  ], {
    type: 'roof',
    levelId: 'L1',
    roofSlope: 0.1,
    roofDirection: 'xPlus',
  });

  const members = state.addRoofSlopeMembers(roof.id, { spacing: 1000 });
  const spans = members.map(member => {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    return [start.x, end.x, start.y, end.y];
  });

  assert.deepEqual(spans, [
    [0, 1500, 1000, 1000],
    [3500, 5000, 1000, 1000],
    [0, 1500, 2000, 2000],
    [3500, 5000, 2000, 2000],
    [0, 1500, 3000, 3000],
    [3500, 5000, 3000, 3000],
  ]);
});

test('member schedule groups line members by type and section with density-based weight', () => {
  const state = new AppState();
  state.addMaterial({ name: 'wood-custom', E: 7000, G: 500, density: 400 });
  state.addSection({ target: 'member', type: 'beam', name: 'W120x240', material: 'wood-custom', b: 120, h: 240 });
  state.addSection({ target: 'member', type: 'beam', name: 'NoMaterial', material: 'missing', b: 100, h: 100 });
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(6000, 0);
  const n3 = state.addNode(6000, 4000);
  state.addMember(n1.id, n2.id, { type: 'beam', levelId: 'L1', sectionName: 'W120x240' });
  state.addMember(n2.id, n3.id, { type: 'beam', levelId: 'L1', sectionName: 'W120x240' });
  state.addMember(n1.id, n3.id, { type: 'beam', levelId: 'L1', sectionName: 'NoMaterial' });
  const column = state.addMember(n1.id, n1.id, { type: 'column', levelId: 'L0', topLevelId: 'L1' });

  assert.equal(computeMemberLengthM(state, column), 2.8);
  const schedule = computeMemberSchedule(state);
  assert.deepEqual(schedule.rows.map(row => [row.type, row.sectionName, row.count]), [
    ['column', '_C', 1],
    ['beam', 'NoMaterial', 1],
    ['beam', 'W120x240', 2],
  ]);
  const wood = schedule.rows[2];
  assert.equal(wood.material, 'wood-custom');
  assert.equal(wood.areaMm2, 28800);
  assert.equal(wood.density, 400);
  assert.ok(Math.abs(wood.unitWeightKgPerM - 11.52) < 1e-9);
  assert.equal(wood.lengthM, 10);
  assert.ok(Math.abs(wood.weightKg - 115.2) < 1e-9);
  const steelColumn = schedule.rows[0];
  assert.equal(steelColumn.lengthM, 2.8);
  assert.ok(Math.abs(steelColumn.unitWeightKgPerM - 105*105/1e6*7850) < 1e-9);
  assert.equal(schedule.rows[1].weightKg, null);
  assert.equal(schedule.rows[1].unitWeightKgPerM, null);
  assert.equal(schedule.totals.count, 4);
  assert.equal(schedule.totals.unknownWeightCount, 1);
  assert.ok(Math.abs(schedule.totals.lengthM - (10 + 2.8 + Math.hypot(6, 4))) < 1e-9);
  assert.ok(Math.abs(schedule.totals.weightKg - (115.2 + steelColumn.weightKg)) < 1e-9);
  assert.equal(schedule.members.length, 4);
  assert.equal(schedule.members.find(row => row.sectionName === 'NoMaterial').weightKg, null);
  assert.ok(schedule.members.every(row => row.pieces === 1));
  assert.deepEqual(computeMemberSchedule(new AppState()), {
    rows: [], members: [], totals: { count: 0, lengthM: 0, weightKg: 0, unknownWeightCount: 0 },
  });
});

test('member schedule counts a cross vertical brace as two diagonals', () => {
  const state = new AppState();
  const n1 = state.addNode(0, 0);
  const n2 = state.addNode(4000, 0);
  state.addMember(n1.id, n2.id, { type: 'vbrace', levelId: 'L0', topLevelId: 'L1', bracePattern: 'single' });
  state.addMember(n1.id, n2.id, { type: 'vbrace', levelId: 'L0', topLevelId: 'L1', bracePattern: 'cross' });
  const diagonalM = Math.hypot(4, 2.8);
  const schedule = computeMemberSchedule(state);
  assert.equal(schedule.rows.length, 1);
  assert.equal(schedule.rows[0].count, 3);
  assert.ok(Math.abs(schedule.rows[0].lengthM - 3*diagonalM) < 1e-9);
  assert.deepEqual(schedule.members.map(row => row.pieces), [1, 2]);
  assert.ok(Math.abs(schedule.members[1].lengthM - 2*diagonalM) < 1e-9);
  assert.equal(schedule.totals.count, 3);
  assert.ok(Math.abs(schedule.totals.weightKg - 3*diagonalM*20*20/1e6*7850) < 1e-9);
  state.addSection({ target: 'member', type: 'vbrace', name: 'NoDensity', material: 'missing', b: 20, h: 20 });
  state.addMember(n1.id, n2.id, { type: 'vbrace', levelId: 'L0', topLevelId: 'L1', bracePattern: 'cross', sectionName: 'NoDensity' });
  assert.equal(computeMemberSchedule(state).totals.unknownWeightCount, 2);
});
