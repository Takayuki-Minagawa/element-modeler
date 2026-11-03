import { createDiagnostic } from './domain/diagnostics.js';
import { planNearbyNodeMerge } from './domain/node-merge.js';
// model-ops.js - Cross-cutting model operations (validation, level copy,
// node merge, member split and copy transforms) extracted from state.js.
// Functions take the AppState instance as their first argument; AppState
// keeps thin delegating methods.

import {
  DEFAULT_ROOF_GROUP_ID,
  MEMBER_JOIN_TOLERANCE_MM,
  MEMBER_SPLIT_TOLERANCE_MM,
  NODE_MERGE_TOLERANCE_MM,
} from './constants.js';
import {
  areCollinear,
  pointsClose,
  positiveNumber,
  segmentParameter,
} from './geometry-utils.js';
import {
  isRoofSurfaceType,
  isWallSurfaceType,
  sanitizeRoofGroupId,
} from './domain/model.js';

export function validateModel(state) {
  const issues = [];
  const addIssue = (severity, code, params, ref = {}) => {
    issues.push(createDiagnostic(severity, code, params, ref));
  };
  const levelIds = new Set(state.levels.map(l => l.id));
  const nodeById = new Map();
  for (const node of state.nodes) if (!nodeById.has(node.id)) nodeById.set(node.id, node);
  const nodeIds = new Set(nodeById.keys());
  const levelZ = new Map();
  for (const level of state.levels) {
    const zKey = String(Number(level.z));
    if (levelZ.has(zKey)) {
      addIssue('warning', 'duplicate-level-z', { name: level.name, other: levelZ.get(zKey) }, { elementType: 'level', elementId: level.id });
    } else {
      levelZ.set(zKey, level.name);
    }
  }

  for (const member of state.members) {
    const n1 = nodeById.get(member.startNodeId);
    const n2 = nodeById.get(member.endNodeId);
    if (!nodeIds.has(member.startNodeId) || !nodeIds.has(member.endNodeId) || !n1 || !n2) {
      addIssue('error', 'missing-node', { id: member.id }, { elementType: 'member', elementId: member.id });
      continue;
    }
    if (!levelIds.has(member.levelId)) {
      addIssue('error', 'missing-level', { id: member.id, type: 'member' }, { elementType: 'member', elementId: member.id });
    }
    if ((member.type === 'column' || member.type === 'vbrace') && !levelIds.has(member.topLevelId)) {
      addIssue('error', 'missing-top-level', { id: member.id, type: 'member' }, { elementType: 'member', elementId: member.id });
    }
    const startZ = member.geometryMode === 'explicit3d' ? state._memberEndpointZ(member, 'startZ') : state.getLevelZ(member.levelId);
    const endZ = member.geometryMode === 'explicit3d' ? state._memberEndpointZ(member, 'endZ') : state.getLevelZ(member.levelId);
    if (member.type !== 'column' && Math.hypot(n2.x - n1.x, n2.y - n1.y, endZ - startZ) < 1) {
      addIssue('warning', 'zero-length-member', { id: member.id }, { elementType: 'member', elementId: member.id });
    }
    if (member.sectionName && !state._getSectionRef('member', member.type, member.sectionName)) {
      addIssue('warning', 'missing-section', { id: member.id, type: 'member', section: member.sectionName }, { elementType: 'member', elementId: member.id });
    }
    if ((member.type === 'column' || member.type === 'vbrace') && member.topLevelId === member.levelId) {
      addIssue('warning', 'same-top-level', { id: member.id }, { elementType: 'member', elementId: member.id });
    }
  }

  const usedNodes = new Set();
  for (const member of state.members) {
    usedNodes.add(member.startNodeId);
    usedNodes.add(member.endNodeId);
  }
  for (const node of state.nodes) {
    if (!usedNodes.has(node.id)) {
      addIssue('info', 'orphan-node', { id: node.id }, { elementType: 'node', elementId: node.id });
    }
  }

  const memberKeys = new Map();
  for (const member of state.members) {
    const n1 = nodeById.get(member.startNodeId);
    const n2 = nodeById.get(member.endNodeId);
    if (!n1 || !n2) continue;
    const startZ = member.geometryMode === 'explicit3d' ? state._memberEndpointZ(member, 'startZ') : state.getLevelZ(member.levelId);
    const endZ = member.geometryMode === 'explicit3d' ? state._memberEndpointZ(member, 'endZ') : state.getLevelZ(member.levelId);
    const points = [
      `${Math.round(n1.x)}:${Math.round(n1.y)}:${Math.round(startZ)}`,
      `${Math.round(n2.x)}:${Math.round(n2.y)}:${Math.round(endZ)}`,
    ].sort();
    const key = [member.type, member.levelId, member.topLevelId || '', ...points].join('|');
    if (memberKeys.has(key)) {
      addIssue('warning', 'duplicate-member', { id: member.id, other: memberKeys.get(key) }, { elementType: 'member', elementId: member.id });
    } else {
      memberKeys.set(key, member.id);
    }
  }

  for (const surface of state.surfaces) {
    if (!levelIds.has(surface.levelId)) {
      addIssue('error', 'missing-level', { id: surface.id, type: 'surface' }, { elementType: 'surface', elementId: surface.id });
    }
    if (isWallSurfaceType(surface.type) && surface.topLevelId && !levelIds.has(surface.topLevelId)) {
      addIssue('error', 'missing-top-level', { id: surface.id, type: 'surface' }, { elementType: 'surface', elementId: surface.id });
    }
    if (surface.shape === 'rect' && (Math.abs(surface.x2 - surface.x1) < 1 || Math.abs(surface.y2 - surface.y1) < 1)) {
      addIssue('warning', 'zero-area-surface', { id: surface.id }, { elementType: 'surface', elementId: surface.id });
    }
    if (surface.sectionName && !state._getSectionRef('surface', surface.type, surface.sectionName)) {
      addIssue('warning', 'missing-section', { id: surface.id, type: 'surface', section: surface.sectionName }, { elementType: 'surface', elementId: surface.id });
    }
  }

  return issues;
}

export function copyLevelElements(state, sourceLevelId, targetLevelId, options = {}) {
  if (!sourceLevelId || !targetLevelId || sourceLevelId === targetLevelId) {
    return { members: 0, surfaces: 0, loads: 0, supports: 0 };
  }
  if (!state.levels.some(l => l.id === sourceLevelId) || !state.levels.some(l => l.id === targetLevelId)) {
    return { members: 0, surfaces: 0, loads: 0, supports: 0 };
  }

  const include = {
    members: options.members !== false,
    surfaces: options.surfaces !== false,
    loads: options.loads !== false,
    supports: options.supports !== false,
  };
  const counts = { members: 0, surfaces: 0, loads: 0, supports: 0 };
  const zDelta = state.getLevelZ(targetLevelId) - state.getLevelZ(sourceLevelId);
  const nodeMap = new Map();
  const nodeFor = (nodeId) => {
    if (nodeMap.has(nodeId)) return nodeMap.get(nodeId);
    const sourceNode = state.getNode(nodeId);
    if (!sourceNode) return null;
    const node = state.addNode(sourceNode.x, sourceNode.y, sourceNode.z || 0);
    nodeMap.set(nodeId, node);
    return node;
  };
  const mapTopLevel = (topLevelId) => {
    if (!topLevelId) return null;
    if (topLevelId === sourceLevelId || topLevelId === state.getNextLevelId(sourceLevelId)) {
      return state.getNextLevelId(targetLevelId) || targetLevelId;
    }
    return topLevelId;
  };
  const mapRoofGroupId = (roofGroupId) => {
    const base = sanitizeRoofGroupId(roofGroupId, DEFAULT_ROOF_GROUP_ID);
    return sanitizeRoofGroupId(`${base}_${targetLevelId}`, `${base}_${targetLevelId}`);
  };

  if (include.members) {
    const sourceMembers = [...state.members].filter(m => m.levelId === sourceLevelId);
    for (const member of sourceMembers) {
      if (member.roofRole) continue;
      const startNode = nodeFor(member.startNodeId);
      const endNode = nodeFor(member.endNodeId);
      if (!startNode || !endNode) continue;
      const copied = state.addMember(startNode.id, endNode.id, {
        type: member.type,
        sectionName: member.sectionName,
        levelId: targetLevelId,
        topLevelId: (member.type === 'column' || member.type === 'vbrace')
          ? (state.getNextLevelId(targetLevelId) || targetLevelId)
          : mapTopLevel(member.topLevelId),
        geometryMode: member.geometryMode,
        startZ: member.geometryMode === 'explicit3d' && Number.isFinite(Number(member.startZ))
          ? Number(member.startZ) + zDelta
          : member.startZ,
        endZ: member.geometryMode === 'explicit3d' && Number.isFinite(Number(member.endZ))
          ? Number(member.endZ) + zDelta
          : member.endZ,
        roofRole: null,
        bracePattern: member.bracePattern,
        endI: member.endI,
        endJ: member.endJ,
      });
      if (copied) counts.members++;
    }
  }

  if (include.surfaces) {
    const sourceSurfaces = [...state.surfaces].filter(s => s.levelId === sourceLevelId);
    for (const surface of sourceSurfaces) {
      const common = {
        type: surface.type,
        sectionName: surface.sectionName,
        levelId: targetLevelId,
        topLevelId: mapTopLevel(surface.topLevelId) || targetLevelId,
        loadDirection: surface.loadDirection,
        heightMode: surface.heightMode,
        bottomOffset: surface.bottomOffset,
        topOffset: surface.topOffset,
        includeWind: surface.includeWind,
        includeSeismicWeight: surface.includeSeismicWeight,
        unitWeight: surface.unitWeight,
        roofSlope: surface.roofSlope,
        roofDirection: surface.roofDirection,
        roofBaseOffset: surface.roofBaseOffset,
        roofGroupId: isRoofSurfaceType(surface.type) ? mapRoofGroupId(surface.roofGroupId) : surface.roofGroupId,
        gableStartTopOffset: surface.gableStartTopOffset,
        gableEndTopOffset: surface.gableEndTopOffset,
      };
      let copied = null;
      if (surface.shape === 'polygon' && Array.isArray(surface.points)) {
        copied = state.addSurfacePolygon(surface.points.map(p => ({ ...p })), common);
      } else if (surface.shape === 'line') {
        copied = state.addSurfaceLine(surface.x1, surface.y1, surface.x2, surface.y2, common);
      } else {
        copied = state.addSurfaceRect(surface.x1, surface.y1, surface.x2, surface.y2, common);
      }
      if (copied) counts.surfaces++;
    }
  }

  if (include.loads) {
    const sourceLoads = [...state.loads].filter(l => l.levelId === sourceLevelId);
    for (const load of sourceLoads) {
      const props = { ...load, levelId: targetLevelId };
      delete props.id;
      if (state.addLoad(load.type, props)) counts.loads++;
    }
  }

  if (include.supports) {
    const sourceSupports = [...state.supports].filter(s => s.levelId === sourceLevelId);
    for (const support of sourceSupports) {
      const props = { ...support, levelId: targetLevelId };
      delete props.id;
      if (state.addSupport(support.x, support.y, props)) counts.supports++;
    }
  }

  return counts;
}

// --- Node merge -------------------------------------------------------------

// Merges nodes within `tolerance` (mm) of a surviving, lower-ID node.
// Proximity is not transitive; members are re-pointed to the survivor.
export function mergeNearbyNodes(state, options = {}) {
  const tolerance = positiveNumber(options.tolerance, NODE_MERGE_TOLERANCE_MM);
  const remap = planNearbyNodeMerge(state.nodes, tolerance);

  if (!remap.size) return { mergedNodes: 0 };

  for (const member of state.members) {
    if (remap.has(member.startNodeId)) member.startNodeId = remap.get(member.startNodeId);
    if (remap.has(member.endNodeId)) member.endNodeId = remap.get(member.endNodeId);
  }
  state.nodes = state.nodes.filter(n => !remap.has(n.id));
  state._touch();
  return { mergedNodes: remap.size };
}

// --- Member join ------------------------------------------------------------

function joinFailure(reason, sections = []) {
  return { ok: false, reason, sections, chain: [] };
}

function uniqueIds(ids) {
  return [...new Set(Array.isArray(ids) ? ids : [])];
}

function sectionNames(members) {
  return [...new Set(members.map(member => member.sectionName))];
}

function beamJoinChain(state, members) {
  const endpointMembers = new Map();
  const addEndpoint = (nodeId, member) => {
    const connected = endpointMembers.get(nodeId) || [];
    connected.push(member);
    endpointMembers.set(nodeId, connected);
  };

  for (const member of members) {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    if (!start || !end) return { reason: 'disconnected' };
    if (member.startNodeId === member.endNodeId) return { reason: 'non-collinear' };
    addEndpoint(member.startNodeId, member);
    addEndpoint(member.endNodeId, member);
  }

  if ([...endpointMembers.values()].some(connected => connected.length > 2)) {
    return { reason: 'disconnected' };
  }
  const endNodeIds = [...endpointMembers]
    .filter(([, connected]) => connected.length === 1)
    .map(([nodeId]) => nodeId)
    .sort((a, b) => {
      const numericA = Number(a);
      const numericB = Number(b);
      if (Number.isFinite(numericA) && Number.isFinite(numericB)) return numericA - numericB;
      return String(a).localeCompare(String(b));
    });
  if (endNodeIds.length !== 2) return { reason: 'disconnected' };

  let ordered = [];
  const visited = new Set();
  let nodeIds = [endNodeIds[0]];
  let currentNodeId = endNodeIds[0];

  while (ordered.length < members.length) {
    const nextMembers = (endpointMembers.get(currentNodeId) || [])
      .filter(member => !visited.has(member.id));
    if (nextMembers.length !== 1) return { reason: 'disconnected' };
    const member = nextMembers[0];
    const nextNodeId = member.startNodeId === currentNodeId
      ? member.endNodeId
      : member.startNodeId;
    ordered.push({ member, fromNodeId: currentNodeId, toNodeId: nextNodeId });
    visited.add(member.id);
    nodeIds.push(nextNodeId);
    currentNodeId = nextNodeId;
  }

  if (currentNodeId !== endNodeIds[1] || visited.size !== members.length) {
    return { reason: 'disconnected' };
  }

  // Keep the direction stable independently of selection order. The oldest
  // member's stored I->J orientation is the best available canonical hint and
  // makes split -> join restore the original member orientation as well.
  const anchor = [...members].sort((a, b) =>
    String(a.id).localeCompare(String(b.id), undefined, { numeric: true })
  )[0];
  const anchorEntry = ordered.find(entry => entry.member.id === anchor.id);
  if (anchorEntry.fromNodeId !== anchor.startNodeId) {
    ordered = ordered.reverse().map(entry => ({
      member: entry.member,
      fromNodeId: entry.toNodeId,
      toNodeId: entry.fromNodeId,
    }));
    nodeIds = nodeIds.reverse();
  }

  const start = state.getNode(nodeIds[0]);
  const end = state.getNode(nodeIds[nodeIds.length - 1]);
  if (!start || !end || Math.hypot(end.x - start.x, end.y - start.y) <= MEMBER_JOIN_TOLERANCE_MM) {
    return { reason: 'non-collinear' };
  }
  const points = nodeIds.map(nodeId => state.getNode(nodeId));
  if (points.some(point => !point) || points.some(point =>
    !areCollinear(start, end, point, MEMBER_JOIN_TOLERANCE_MM)
  )) {
    return { reason: 'non-collinear' };
  }

  // A collinear graph can still fold back over itself. Every successive node
  // must advance toward the opposite chain end for the join to be reversible.
  let previousT = -Infinity;
  for (const point of points) {
    const t = segmentParameter(point.x, point.y, start.x, start.y, end.x, end.y);
    if (t <= previousT) return { reason: 'disconnected' };
    previousT = t;
  }

  return { ordered, nodeIds };
}

function columnJoinChain(state, members) {
  const firstStart = state.getNode(members[0].startNodeId);
  if (!firstStart) return { reason: 'disconnected' };

  const byBottomLevel = new Map();
  const byTopLevel = new Map();
  for (const member of members) {
    const start = state.getNode(member.startNodeId);
    const end = state.getNode(member.endNodeId);
    if (!start || !end) return { reason: 'disconnected' };
    if (!pointsClose(firstStart, start, MEMBER_JOIN_TOLERANCE_MM) ||
      !pointsClose(firstStart, end, MEMBER_JOIN_TOLERANCE_MM)) {
      return { reason: 'column-position-mismatch' };
    }
    const bottom = state.levels.find(level => level.id === member.levelId);
    const top = state.levels.find(level => level.id === member.topLevelId);
    if (!bottom || !top || Number(top.z) <= Number(bottom.z)) {
      return { reason: 'level-mismatch' };
    }
    if (byBottomLevel.has(member.levelId) || byTopLevel.has(member.topLevelId)) {
      return { reason: 'level-mismatch' };
    }
    byBottomLevel.set(member.levelId, member);
    byTopLevel.set(member.topLevelId, member);
  }

  const starts = members.filter(member => !byTopLevel.has(member.levelId));
  if (starts.length !== 1) return { reason: 'disconnected' };

  const ordered = [];
  const visited = new Set();
  let current = starts[0];
  while (current && !visited.has(current.id)) {
    ordered.push({
      member: current,
      fromNodeId: current.startNodeId,
      toNodeId: current.endNodeId,
    });
    visited.add(current.id);
    current = byBottomLevel.get(current.topLevelId);
  }
  if (ordered.length !== members.length || current) return { reason: 'disconnected' };

  return { ordered };
}

function inspectJoin(state, memberIds) {
  const ids = uniqueIds(memberIds);
  if (ids.length < 2) return joinFailure('insufficient-members');

  const members = ids.map(id => state.getMember(id));
  if (members.some(member => !member)) return joinFailure('missing-member');
  const sections = sectionNames(members);
  const type = members[0].type;
  if (members.some(member => member.type !== type)) {
    return joinFailure('type-mismatch', sections);
  }
  if (type !== 'beam' && type !== 'column') {
    return joinFailure('unsupported-type', sections);
  }
  if (members.some(member => member.roofRole || member.geometryMode === 'explicit3d')) {
    return joinFailure('unsupported-geometry', sections);
  }

  let inspection;
  if (type === 'beam') {
    if (members.some(member => member.levelId !== members[0].levelId)) {
      return joinFailure('level-mismatch', sections);
    }
    inspection = beamJoinChain(state, members);
  } else {
    inspection = columnJoinChain(state, members);
  }
  if (inspection.reason) return joinFailure(inspection.reason, sections);

  return {
    ok: true,
    sections,
    chain: inspection.ordered.map(entry => entry.member.id),
    type,
    ...inspection,
  };
}

// Validates a selected set without mutating the model. `chain` contains the
// ordered member ids from one outer end to the other.
export function canJoinMembers(state, memberIds) {
  const inspection = inspectJoin(state, memberIds);
  return inspection.ok
    ? { ok: true, sections: inspection.sections, chain: inspection.chain }
    : inspection;
}

function memberEndAt(member, nodeId) {
  return member.startNodeId === nodeId ? member.endI : member.endJ;
}

function pointMatchesNode(point, node, tolerance = MEMBER_JOIN_TOLERANCE_MM) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)) &&
    Math.hypot(Number(point.x) - node.x, Number(point.y) - node.y) <= tolerance;
}

function nodeHasAttachmentAtLevels(state, node, levelIds) {
  const matchesLevel = entry => levelIds.has(entry.levelId);
  if (state.supports.some(support => matchesLevel(support) && pointMatchesNode(support, node))) {
    return true;
  }
  return state.loads.some(load => {
    if (!matchesLevel(load)) return false;
    if (pointMatchesNode({ x: load.x1, y: load.y1 }, node)) return true;
    return load.type === 'lineLoad' && pointMatchesNode({ x: load.x2, y: load.y2 }, node);
  });
}

function nodesToPreserveForJoin(state, inspection, newStartNodeId, newEndNodeId) {
  const levelsByNode = new Map();
  const addLevel = (nodeId, levelId) => {
    if (nodeId === newStartNodeId || nodeId === newEndNodeId) return;
    const levels = levelsByNode.get(nodeId) || new Set();
    levels.add(levelId);
    levelsByNode.set(nodeId, levels);
  };

  if (inspection.type === 'beam') {
    for (const nodeId of inspection.nodeIds.slice(1, -1)) {
      addLevel(nodeId, inspection.ordered[0].member.levelId);
    }
  } else {
    for (const { member } of inspection.ordered) {
      addLevel(member.startNodeId, member.levelId);
      addLevel(member.endNodeId, member.topLevelId);
    }
  }

  const snapshots = [];
  for (const [nodeId, levelIds] of levelsByNode) {
    const node = state.getNode(nodeId);
    if (node && nodeHasAttachmentAtLevels(state, node, levelIds)) snapshots.push({ ...node });
  }
  return snapshots;
}

// Joins a validated beam/column chain. When sections differ the caller must
// choose one of the existing names through options.sectionName.
export function joinMembers(state, memberIds, options = {}) {
  const inspection = inspectJoin(state, memberIds);
  if (!inspection.ok) return null;

  const sectionName = inspection.sections.length === 1
    ? inspection.sections[0]
    : options.sectionName;
  if (!inspection.sections.includes(sectionName)) return null;

  const first = inspection.ordered[0];
  const last = inspection.ordered[inspection.ordered.length - 1];
  const isColumn = inspection.type === 'column';
  const startNodeId = first.fromNodeId;
  // Columns use one plan node for both 3D endpoints; their levels provide z.
  const endNodeId = isColumn ? startNodeId : last.toNodeId;
  const preservedNodes = nodesToPreserveForJoin(state, inspection, startNodeId, endNodeId);
  const joined = state.addMember(startNodeId, endNodeId, {
    type: inspection.type,
    sectionName,
    levelId: first.member.levelId,
    topLevelId: isColumn ? last.member.topLevelId : first.member.topLevelId,
    endI: isColumn ? first.member.endI : memberEndAt(first.member, first.fromNodeId),
    endJ: isColumn ? last.member.endJ : memberEndAt(last.member, last.toNodeId),
  });

  for (const { member } of inspection.ordered) state.removeMember(member.id);

  let restoredNode = false;
  for (const snapshot of preservedNodes) {
    if (state.getNode(snapshot.id)) continue;
    state.nodes.push(snapshot);
    restoredNode = true;
  }
  if (restoredNode) state._touch();

  return { joined: inspection.ordered.length, memberId: joined.id };
}

// --- Member split at intersections ------------------------------------------

// Returns the intersection point of segments a1-a2 / b1-b2 when they properly
// cross (interior-interior); null for parallel or non-crossing segments.
function segmentCrossPoint(a1, a2, b1, b2) {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const dbx = b2.x - b1.x;
  const dby = b2.y - b1.y;
  const cross = dax * dby - day * dbx;
  if (Math.abs(cross) < 1e-9) return null;
  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / cross;
  const u = ((b1.x - a1.x) * day - (b1.y - a1.y) * dax) / cross;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { x: a1.x + t * dax, y: a1.y + t * day };
}

// Projects point p onto segment a-b; returns the projected point when it lies
// strictly inside the segment and within `tolerance` of p, otherwise null.
function interiorProjection(p, a, b, tolerance) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const len = Math.sqrt(len2);
  const minT = tolerance / len;
  if (t <= minT || t >= 1 - minT) return null;
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  if (Math.hypot(proj.x - p.x, proj.y - p.y) > tolerance) return null;
  return proj;
}

function derivedMemberOptions(member, overrides = {}) {
  return {
    type: member.type,
    sectionName: member.sectionName,
    levelId: member.levelId,
    topLevelId: member.topLevelId,
    geometryMode: member.geometryMode,
    startZ: member.startZ,
    endZ: member.endZ,
    roofRole: member.roofRole,
    bracePattern: member.bracePattern,
    ...overrides,
  };
}

// Replaces one in-plane member with a node chain. Outer end conditions are
// inherited; every newly cut internal end is rigid.
function replaceMemberWithNodeChain(state, member, chain) {
  if (!member || chain.length < 3 || chain.some(node => !node)) return null;
  const created = [];
  for (let index = 0; index < chain.length - 1; index++) {
    const isFirst = index === 0;
    const isLast = index === chain.length - 2;
    const segment = state.addMember(chain[index].id, chain[index + 1].id, derivedMemberOptions(member, {
      endI: isFirst ? member.endI : { condition: 'rigid', springSymbol: null },
      endJ: isLast ? member.endJ : { condition: 'rigid', springSymbol: null },
    }));
    created.push(segment.id);
  }
  state.removeMember(member.id);
  return created;
}

// Splits an ordinary in-plane beam at the projection of an arbitrary point.
export function splitMemberAtPoint(state, memberId, options = {}) {
  const member = state.getMember(memberId);
  if (!member || member.type !== 'beam' || member.roofRole || member.geometryMode === 'explicit3d') {
    return null;
  }
  const start = state.getNode(member.startNodeId);
  const end = state.getNode(member.endNodeId);
  const x = Number(options.x);
  const y = Number(options.y);
  if (!start || !end || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;
  const tolerance = positiveNumber(options.tolerance, MEMBER_SPLIT_TOLERANCE_MM);
  const t = segmentParameter(x, y, start.x, start.y, end.x, end.y);
  if (t <= tolerance / length || t >= 1 - tolerance / length) return null;

  const splitPoint = { x: start.x + t * dx, y: start.y + t * dy };
  let splitNode = state.findNodeAt(splitPoint.x, splitPoint.y, Math.max(tolerance, 1));
  if (!splitNode) splitNode = state.addNode(splitPoint.x, splitPoint.y);
  const createdMemberIds = replaceMemberWithNodeChain(state, member, [start, splitNode, end]);
  return createdMemberIds ? { createdMemberIds } : null;
}

// Columns remain level-based: the cut must be an existing level strictly
// between the member's bottom and top levels.
export function splitColumnAtLevel(state, memberId, options = {}) {
  const member = state.getMember(memberId);
  if (!member || member.type !== 'column' || member.roofRole || member.geometryMode === 'explicit3d') {
    return null;
  }
  const splitLevel = state.levels.find(level => level.id === options.levelId);
  const bottomLevel = state.levels.find(level => level.id === member.levelId);
  const topLevel = state.levels.find(level => level.id === member.topLevelId);
  if (!splitLevel || !bottomLevel || !topLevel ||
    Number(splitLevel.z) <= Number(bottomLevel.z) ||
    Number(splitLevel.z) >= Number(topLevel.z)) {
    return null;
  }
  if (!state.getNode(member.startNodeId) || !state.getNode(member.endNodeId)) return null;

  const lower = state.addMember(member.startNodeId, member.endNodeId, derivedMemberOptions(member, {
    levelId: member.levelId,
    topLevelId: splitLevel.id,
    endI: member.endI,
    endJ: { condition: 'rigid', springSymbol: null },
  }));
  const upper = state.addMember(member.startNodeId, member.endNodeId, derivedMemberOptions(member, {
    levelId: splitLevel.id,
    topLevelId: member.topLevelId,
    endI: { condition: 'rigid', springSymbol: null },
    endJ: member.endJ,
  }));
  state.removeMember(member.id);
  return { createdMemberIds: [lower.id, upper.id] };
}

// Splits in-plane beams / horizontal braces at their mutual intersection and
// T-junction points so crossing members share analysis nodes. Roof members
// (explicit 3D) and vertical elements are left untouched.
export function splitIntersectingMembers(state, options = {}) {
  const tolerance = positiveNumber(options.tolerance, MEMBER_SPLIT_TOLERANCE_MM);
  const targets = state.members.filter(m =>
    (m.type === 'beam' || m.type === 'hbrace') &&
    m.geometryMode !== 'explicit3d' &&
    !m.roofRole
  );

  const geometry = new Map();
  for (const member of targets) {
    const n1 = state.getNode(member.startNodeId);
    const n2 = state.getNode(member.endNodeId);
    if (!n1 || !n2) continue;
    if (Math.hypot(n2.x - n1.x, n2.y - n1.y) < 1) continue;
    geometry.set(member.id, { member, n1, n2 });
  }

  const splitPoints = new Map();
  const addSplit = (entry, point) => {
    const { member, n1, n2 } = entry;
    const proj = interiorProjection(point, n1, n2, Math.max(tolerance, 1));
    if (!proj) return;
    const list = splitPoints.get(member.id) || [];
    if (list.some(p => Math.hypot(p.x - proj.x, p.y - proj.y) <= tolerance)) return;
    list.push(proj);
    splitPoints.set(member.id, list);
  };

  const entries = [...geometry.values()];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (a.member.levelId !== b.member.levelId) continue;
      const cross = segmentCrossPoint(a.n1, a.n2, b.n1, b.n2);
      if (cross) {
        addSplit(a, cross);
        addSplit(b, cross);
      }
      // T-junctions: an endpoint of one member lying on the other.
      addSplit(a, b.n1);
      addSplit(a, b.n2);
      addSplit(b, a.n1);
      addSplit(b, a.n2);
    }
  }

  if (!splitPoints.size) return { splitMembers: 0, createdMembers: 0 };

  let createdMembers = 0;
  for (const [memberId, points] of splitPoints) {
    const entry = geometry.get(memberId);
    const { member, n1, n2 } = entry;
    const dx = n2.x - n1.x;
    const dy = n2.y - n1.y;
    const len2 = dx * dx + dy * dy;
    points.sort((p, q) => {
      const tp = ((p.x - n1.x) * dx + (p.y - n1.y) * dy) / len2;
      const tq = ((q.x - n1.x) * dx + (q.y - n1.y) * dy) / len2;
      return tp - tq;
    });

    const chain = [state.getNode(member.startNodeId)];
    for (const p of points) {
      let node = state.findNodeAt(p.x, p.y, Math.max(tolerance, 1));
      if (!node) node = state.addNode(p.x, p.y);
      chain.push(node);
    }
    chain.push(state.getNode(member.endNodeId));

    const created = replaceMemberWithNodeChain(state, member, chain);
    createdMembers += created?.length || 0;
  }

  return { splitMembers: splitPoints.size, createdMembers };
}

// --- Copy transforms (mirror / rotate / array) --------------------------------

function copyMemberWithPoints(state, member, p1, p2, nodeTolerance = 1) {
  let startNode = state.findNodeAt(p1.x, p1.y, nodeTolerance);
  if (!startNode) startNode = state.addNode(p1.x, p1.y);
  let endNode = member.type === 'column'
    ? startNode
    : state.findNodeAt(p2.x, p2.y, nodeTolerance);
  if (!endNode) endNode = state.addNode(p2.x, p2.y);
  return state.addMember(startNode.id, endNode.id, {
    type: member.type,
    sectionName: member.sectionName,
    levelId: member.levelId,
    topLevelId: member.topLevelId,
    geometryMode: member.geometryMode,
    startZ: member.startZ,
    endZ: member.endZ,
    roofRole: member.roofRole,
    bracePattern: member.bracePattern,
    endI: member.endI,
    endJ: member.endJ,
  });
}

function resolveMemberEndpoints(state, ids) {
  const resolved = [];
  for (const id of ids) {
    const member = state.getMember(id);
    if (!member) continue;
    const n1 = state.getNode(member.startNodeId);
    const n2 = state.getNode(member.endNodeId);
    if (!n1 || !n2) continue;
    resolved.push({ member, n1, n2 });
  }
  return resolved;
}

// Mirrors the given members across x=coord (axis 'x') or y=coord (axis 'y'),
// creating mirrored copies. Returns the created members.
export function mirrorMembers(state, ids, options = {}) {
  const axis = options.axis === 'y' ? 'y' : 'x';
  const coord = Number(options.coord) || 0;
  const mirror = p => axis === 'x'
    ? { x: 2 * coord - p.x, y: p.y }
    : { x: p.x, y: 2 * coord - p.y };
  const created = [];
  for (const { member, n1, n2 } of resolveMemberEndpoints(state, ids)) {
    created.push(copyMemberWithPoints(state, member, mirror(n1), mirror(n2)));
  }
  return created;
}

// Rotates the given members in place by 90/180/270 degrees (CCW) around the
// selection's bounding-box center (or an explicit cx/cy). Nodes shared with
// unselected members are detached first so the rest of the model stays put.
export function rotateMembers(state, ids, options = {}) {
  const angle = [90, 180, 270].includes(Number(options.angle)) ? Number(options.angle) : 90;
  const resolved = resolveMemberEndpoints(state, ids);
  if (!resolved.length) return { rotated: 0 };

  let cx = Number(options.cx);
  let cy = Number(options.cy);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const { n1, n2 } of resolved) {
      minX = Math.min(minX, n1.x, n2.x);
      maxX = Math.max(maxX, n1.x, n2.x);
      minY = Math.min(minY, n1.y, n2.y);
      maxY = Math.max(maxY, n1.y, n2.y);
    }
    cx = (minX + maxX) / 2;
    cy = (minY + maxY) / 2;
  }

  const idSet = new Set(ids);
  const selectionNodes = new Set();
  for (const { member } of resolved) {
    selectionNodes.add(member.startNodeId);
    selectionNodes.add(member.endNodeId);
  }

  // Detach nodes shared with unselected members.
  const remap = new Map();
  for (const nodeId of selectionNodes) {
    const sharedOutside = state.members.some(m =>
      !idSet.has(m.id) && (m.startNodeId === nodeId || m.endNodeId === nodeId)
    );
    if (!sharedOutside) continue;
    const source = state.getNode(nodeId);
    if (!source) continue;
    const clone = state.addNode(source.x, source.y, source.z || 0);
    remap.set(nodeId, clone.id);
  }
  if (remap.size) {
    for (const { member } of resolved) {
      if (remap.has(member.startNodeId)) member.startNodeId = remap.get(member.startNodeId);
      if (remap.has(member.endNodeId)) member.endNodeId = remap.get(member.endNodeId);
    }
  }

  const rotate = (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    if (angle === 90) return { x: cx - dy, y: cy + dx };
    if (angle === 180) return { x: cx - dx, y: cy - dy };
    return { x: cx + dy, y: cy - dx };
  };

  const doneNodes = new Set();
  for (const { member } of resolved) {
    for (const nodeId of [member.startNodeId, member.endNodeId]) {
      if (doneNodes.has(nodeId)) continue;
      doneNodes.add(nodeId);
      const node = state.getNode(nodeId);
      if (!node) continue;
      const p = rotate(node.x, node.y);
      node.x = p.x;
      node.y = p.y;
    }
  }
  state._touch();
  return { rotated: resolved.length };
}

// Creates `count` copies of the given members, each offset by (dx, dy) from
// the previous copy. Returns the created members.
export function arrayCopyMembers(state, ids, options = {}) {
  const dx = Number(options.dx) || 0;
  const dy = Number(options.dy) || 0;
  const count = Math.max(1, Math.min(100, Math.round(Number(options.count) || 1)));
  if (dx === 0 && dy === 0) return [];
  const resolved = resolveMemberEndpoints(state, ids);
  const created = [];
  for (let k = 1; k <= count; k++) {
    for (const { member, n1, n2 } of resolved) {
      created.push(copyMemberWithPoints(
        state,
        member,
        { x: n1.x + dx * k, y: n1.y + dy * k },
        { x: n2.x + dx * k, y: n2.y + dy * k }
      ));
    }
  }
  return created;
}
