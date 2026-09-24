// quantities.js - projected wind areas and seismic weight summaries

import { MM2_TO_M2 } from './constants.js';
import { ROOF_MEMBER_ROLE_ORDER } from './element-style.js';
import { finiteNumber, signedArea2 } from './geometry-utils.js';
import { roofActualAreaM2, roofProjectionAreasM2 } from './roof-geometry.js';
import { sectionProperties } from './section-catalog.js';
import { isGableWallSurfaceType, isSlopedSurfaceType, isWallSurfaceType } from './state.js';
import { braceDiagonals } from './view-semantics.js';

export function resolveSurfaceVerticalRange(state, surface) {
  const baseZ = state.getLevelZ(surface.levelId);
  const storyHeight = getStoryHeight(state, surface.levelId, surface.topLevelId);
  const bottomOffset = finiteNumber(surface.bottomOffset, 0);
  const topOffset = finiteNumber(surface.topOffset, storyHeight);
  const bottom = baseZ + bottomOffset;
  const top = baseZ + topOffset;
  const height = Math.max(0, top - bottom);
  return { bottom, top, height, bottomOffset, topOffset };
}

/**
 * Summarizes surface quantities and roof framing quantities.
 *
 * Surface totals keep wind projected areas and seismic weight together because
 * they share the same per-level rollup. Roof member counts/lengths are exposed
 * under roofMembers so callers do not mix area, force, and linear quantities.
 */
export function computeQuantitySummary(state) {
  const levels = [...(state.levels || [])].sort((a, b) => a.z - b.z);
  const byLevel = new Map(levels.map(level => [
    level.id,
    {
      levelId: level.id,
      label: `${level.name} (z=${level.z})`,
      windXAreaM2: 0,
      windYAreaM2: 0,
      seismicWeightN: 0,
    },
  ]));

  const ensureLevel = levelId => {
    if (!byLevel.has(levelId)) {
      byLevel.set(levelId, {
        levelId,
        label: levelId || '-',
        windXAreaM2: 0,
        windYAreaM2: 0,
        seismicWeightN: 0,
      });
    }
    return byLevel.get(levelId);
  };

  const totals = {
    windXAreaM2: 0,
    windYAreaM2: 0,
    seismicWeightN: 0,
  };

  for (const surface of state.surfaces || []) {
    const levelSummary = ensureLevel(surface.levelId);

    if ((isWallSurfaceType(surface.type) || isSlopedSurfaceType(surface.type)) && surface.includeWind !== false) {
      const wind = computeSurfaceWindProjectionM2(state, surface);
      levelSummary.windXAreaM2 += wind.xAreaM2;
      levelSummary.windYAreaM2 += wind.yAreaM2;
      totals.windXAreaM2 += wind.xAreaM2;
      totals.windYAreaM2 += wind.yAreaM2;
    }

    if (surface.includeSeismicWeight) {
      const weight = computeSurfaceSeismicWeightN(state, surface);
      levelSummary.seismicWeightN += weight;
      totals.seismicWeightN += weight;
    }
  }

  return {
    levels: Array.from(byLevel.values()),
    totals,
    roofMembers: computeRoofMemberSummary(state),
  };
}

export function computeRoofMemberSummary(state) {
  const byRole = new Map();
  const ensureRole = roofRole => {
    if (!byRole.has(roofRole)) {
      byRole.set(roofRole, {
        roofRole,
        count: 0,
        lengthM: 0,
      });
    }
    return byRole.get(roofRole);
  };

  for (const member of state.members || []) {
    if (!member.roofRole) continue;
    const row = ensureRole(member.roofRole);
    row.count += 1;
    row.lengthM += computeMemberLengthM(state, member);
  }

  const rows = [...byRole.values()].sort((a, b) => (
    roofRoleSortIndex(a.roofRole) - roofRoleSortIndex(b.roofRole) ||
    a.roofRole.localeCompare(b.roofRole)
  ));
  return {
    rows,
    totals: {
      count: rows.reduce((sum, row) => sum + row.count, 0),
      lengthM: rows.reduce((sum, row) => sum + row.lengthM, 0),
    },
  };
}

const MEMBER_TYPE_ORDER = ['column', 'beam', 'hbrace', 'vbrace'];
const MM2_PER_M2 = 1e6;

function optionalPositive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Member schedule grouped by (type, section name): counts, total length and
 * weight from material density x section area. Rows without a resolvable
 * section area or material density report weight null instead of 0 so the
 * totals never silently omit members. Weight = density [kg/m3] x A [mm2] / 1e6 x L [m].
 * A cross (X) vertical brace is one CAD member but two physical diagonals, so
 * it counts as two pieces with twice the diagonal length, matching the 2D/3D
 * drawing and the analysis export.
 */
export function computeMemberSchedule(state) {
  const groups = new Map();
  const members = [];
  for (const member of state.members || []) {
    const type = member.type || '';
    const sectionName = member.sectionName || '';
    const section = sectionName ? state.getSection('member', type, sectionName) : null;
    const properties = section ? sectionProperties(section) : null;
    const areaMm2 = optionalPositive(properties?.A);
    const materialName = section?.material || '';
    const density = optionalPositive(materialName ? state.getMaterial(materialName)?.density : null);
    const unitWeightKgPerM = areaMm2 !== null && density !== null ? areaMm2 / MM2_PER_M2 * density : null;
    const pieces = type === 'vbrace' ? braceDiagonals(member.bracePattern).length : 1;
    const lengthM = computeMemberLengthM(state, member) * pieces;
    const weightKg = unitWeightKgPerM === null ? null : unitWeightKgPerM * lengthM;
    const key = `${type}\u0000${sectionName}`;
    if (!groups.has(key)) {
      groups.set(key, {
        type, sectionName, material: materialName, areaMm2, density, unitWeightKgPerM,
        count: 0, lengthM: 0, weightKg: unitWeightKgPerM === null ? null : 0,
      });
    }
    const group = groups.get(key);
    group.count += pieces;
    group.lengthM += lengthM;
    if (group.weightKg !== null) group.weightKg += weightKg;
    members.push({
      id: member.id || '', type, sectionName, levelId: member.levelId || '', roofRole: member.roofRole || '',
      pieces, lengthM, weightKg,
    });
  }
  const typeIndex = type => {
    const index = MEMBER_TYPE_ORDER.indexOf(type);
    return index === -1 ? MEMBER_TYPE_ORDER.length : index;
  };
  const rows = [...groups.values()].sort((a, b) => (
    typeIndex(a.type) - typeIndex(b.type) ||
    a.type.localeCompare(b.type) ||
    a.sectionName.localeCompare(b.sectionName)
  ));
  const unknownWeightCount = members.filter(row => row.weightKg === null).length;
  return {
    rows,
    members,
    totals: {
      count: members.reduce((sum, row) => sum + row.pieces, 0),
      lengthM: rows.reduce((sum, row) => sum + row.lengthM, 0),
      weightKg: rows.reduce((sum, row) => sum + (row.weightKg ?? 0), 0),
      unknownWeightCount,
    },
  };
}

export function computeMemberLengthM(state, member) {
  const startNode = state.getNode(member.startNodeId);
  const endNode = state.getNode(member.endNodeId);
  if (!startNode || !endNode) return 0;
  const dx = finiteNumber(endNode.x, 0) - finiteNumber(startNode.x, 0);
  const dy = finiteNumber(endNode.y, 0) - finiteNumber(startNode.y, 0);
  return Math.hypot(dx, dy, resolveMemberEndZ(state, member, 'end') - resolveMemberEndZ(state, member, 'start')) / 1000;
}

// Columns and vertical braces span from levelId to topLevelId; other members
// sit on their level unless they carry explicit 3D end elevations. Shared with
// the analysis export so quantities and analysis geometry cannot drift apart.
export function resolveMemberEndZ(state, member, which) {
  if (member.type === 'column' || member.type === 'vbrace') {
    return which === 'start'
      ? state.getLevelZ(member.levelId)
      : state.getLevelZ(member.topLevelId || member.levelId);
  }
  if (member.geometryMode === 'explicit3d') {
    const value = Number(which === 'start' ? member.startZ : member.endZ);
    if (Number.isFinite(value)) return value;
  }
  return state.getLevelZ(member.levelId);
}

export function computeSurfaceWindProjectionM2(state, surface) {
  if (isSlopedSurfaceType(surface.type)) return roofProjectionAreasM2(state, surface);
  if (isGableWallSurfaceType(surface.type)) return computeGableWallWindProjectionM2(state, surface);
  if (!isWallSurfaceType(surface.type)) return { xAreaM2: 0, yAreaM2: 0 };
  const { height } = resolveSurfaceVerticalRange(state, surface);
  if (height <= 0) return { xAreaM2: 0, yAreaM2: 0 };

  if (surface.type === 'exteriorWall' && (
    surface.shape === 'rect' ||
    (surface.shape === 'polygon' && Array.isArray(surface.points) && surface.points.length >= 3)
  )) {
    return computeExteriorWallWindProjectionM2(surface, height);
  }

  let xAreaMm2 = 0;
  let yAreaMm2 = 0;
  for (const seg of surfacePlanSegments(surface)) {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    xAreaMm2 += Math.abs(dy) * height;
    yAreaMm2 += Math.abs(dx) * height;
  }
  return {
    xAreaM2: xAreaMm2 * MM2_TO_M2,
    yAreaM2: yAreaMm2 * MM2_TO_M2,
  };
}

export function computeSurfaceSeismicWeightN(state, surface) {
  const unitWeight = Math.max(0, finiteNumber(surface.unitWeight, 0));
  if (unitWeight <= 0) return 0;
  const areaM2 = computeSurfaceWeightAreaM2(state, surface);
  return areaM2 * unitWeight;
}

export function computeSurfaceWeightAreaM2(state, surface) {
  if (isSlopedSurfaceType(surface.type)) return roofActualAreaM2(surface);
  if (isGableWallSurfaceType(surface.type)) return gableWallAreaM2(state, surface);
  if (isWallSurfaceType(surface.type)) {
    const { height } = resolveSurfaceVerticalRange(state, surface);
    if (height <= 0) return 0;
    return surfacePlanLengthMm(surface) * height * MM2_TO_M2;
  }
  return horizontalSurfaceAreaM2(surface);
}

function computeGableWallWindProjectionM2(state, surface) {
  const avgHeight = gableWallAverageHeightMm(state, surface);
  if (avgHeight <= 0) return { xAreaM2: 0, yAreaM2: 0 };
  let xAreaMm2 = 0;
  let yAreaMm2 = 0;
  for (const seg of surfacePlanSegments(surface)) {
    const dx = seg.b.x - seg.a.x;
    const dy = seg.b.y - seg.a.y;
    xAreaMm2 += Math.abs(dy) * avgHeight;
    yAreaMm2 += Math.abs(dx) * avgHeight;
  }
  return {
    xAreaM2: xAreaMm2 * MM2_TO_M2,
    yAreaM2: yAreaMm2 * MM2_TO_M2,
  };
}

function computeExteriorWallWindProjectionM2(surface, height) {
  const segments = surfacePlanSegments(surface);
  return {
    xAreaM2: projectedSegmentUnionLengthMm(segments, 'y') * height * MM2_TO_M2,
    yAreaM2: projectedSegmentUnionLengthMm(segments, 'x') * height * MM2_TO_M2,
  };
}

function projectedSegmentUnionLengthMm(segments, coordinateKey) {
  const intervals = [];
  for (const seg of segments) {
    const a = finiteNumber(seg.a[coordinateKey], 0);
    const b = finiteNumber(seg.b[coordinateKey], a);
    if (Math.abs(b - a) <= 0.001) continue;
    intervals.push(a < b ? [a, b] : [b, a]);
  }
  return intervalUnionLengthMm(intervals);
}

function intervalUnionLengthMm(intervals) {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let length = 0;
  let [start, end] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [nextStart, nextEnd] = sorted[i];
    if (nextStart <= end + 0.001) {
      end = Math.max(end, nextEnd);
    } else {
      length += Math.max(0, end - start);
      start = nextStart;
      end = nextEnd;
    }
  }
  length += Math.max(0, end - start);
  return length;
}

function gableWallAreaM2(state, surface) {
  const avgHeight = gableWallAverageHeightMm(state, surface);
  if (avgHeight <= 0) return 0;
  return surfacePlanLengthMm(surface) * avgHeight * MM2_TO_M2;
}

function gableWallAverageHeightMm(state, surface) {
  const baseZ = state.getLevelZ(surface.levelId);
  const bottom = baseZ + finiteNumber(surface.bottomOffset, 0);
  const topStart = baseZ + finiteNumber(surface.gableStartTopOffset, surface.topOffset);
  const topEnd = baseZ + finiteNumber(surface.gableEndTopOffset, surface.topOffset);
  const h1 = Math.max(0, topStart - bottom);
  const h2 = Math.max(0, topEnd - bottom);
  return (h1 + h2) / 2;
}

export function horizontalSurfaceAreaM2(surface) {
  if (surface.shape === 'polygon' && Array.isArray(surface.points) && surface.points.length >= 3) {
    return Math.abs(signedArea2(surface.points)) * 0.5 * MM2_TO_M2;
  }
  if (surface.shape === 'rect') {
    return Math.abs((surface.x2 - surface.x1) * (surface.y2 - surface.y1)) * MM2_TO_M2;
  }
  return 0;
}

function surfacePlanLengthMm(surface) {
  return surfacePlanSegments(surface).reduce((sum, seg) => (
    sum + Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y)
  ), 0);
}

function surfacePlanSegments(surface) {
  if (surface.shape === 'line') {
    return [{
      a: { x: finiteNumber(surface.x1, 0), y: finiteNumber(surface.y1, 0) },
      b: { x: finiteNumber(surface.x2, 0), y: finiteNumber(surface.y2, 0) },
    }];
  }

  if (surface.shape === 'polygon' && Array.isArray(surface.points) && surface.points.length >= 2) {
    return surface.points.map((point, idx) => ({
      a: point,
      b: surface.points[(idx + 1) % surface.points.length],
    }));
  }

  if (surface.shape === 'rect') {
    const x1 = finiteNumber(surface.x1, 0);
    const y1 = finiteNumber(surface.y1, 0);
    const x2 = finiteNumber(surface.x2, x1);
    const y2 = finiteNumber(surface.y2, y1);
    const points = [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];
    return points.map((point, idx) => ({
      a: point,
      b: points[(idx + 1) % points.length],
    }));
  }

  return [];
}

function roofRoleSortIndex(roofRole) {
  const index = ROOF_MEMBER_ROLE_ORDER.indexOf(roofRole);
  return index >= 0 ? index : ROOF_MEMBER_ROLE_ORDER.length;
}

function getStoryHeight(state, levelId, topLevelId) {
  return Math.max(0, state.getLevelZ(topLevelId) - state.getLevelZ(levelId));
}
