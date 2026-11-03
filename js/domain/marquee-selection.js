// Shared rectangle-selection rules for input and its canvas preview.
export function marqueeSelectionMode(marquee) {
  return marquee.x2 < marquee.x1 ? 'crossing' : 'window';
}

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function marqueeBounds(marquee) {
  if (!marquee || ![marquee.x1, marquee.y1, marquee.x2, marquee.y2].every(Number.isFinite)) return null;
  return {
    minX: Math.min(marquee.x1, marquee.x2), maxX: Math.max(marquee.x1, marquee.x2),
    minY: Math.min(marquee.y1, marquee.y2), maxY: Math.max(marquee.y1, marquee.y2),
    crossing: marqueeSelectionMode(marquee) === 'crossing',
  };
}

function contains(point, bounds) {
  return point.x >= bounds.minX && point.x <= bounds.maxX &&
    point.y >= bounds.minY && point.y <= bounds.maxY;
}

function segmentMatchesBounds(start, end, bounds) {
  if (!bounds || !finitePoint(start) || !finitePoint(end)) return false;
  if (!bounds.crossing) return contains(start, bounds) && contains(end, bounds);

  // Clip the segment parameter [0, 1] to each axis slab. Boundaries are
  // inclusive, including a column whose two plan endpoints coincide.
  let enter = 0, exit = 1;
  for (const [axis, min, max] of [['x', bounds.minX, bounds.maxX], ['y', bounds.minY, bounds.maxY]]) {
    const delta = end[axis] - start[axis];
    if (!Number.isFinite(delta)) return false;
    if (delta === 0) {
      if (start[axis] < min || start[axis] > max) return false;
      continue;
    }
    const t1 = (min - start[axis]) / delta, t2 = (max - start[axis]) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return false;
  }
  return true;
}

export function segmentMatchesMarquee(start, end, marquee) {
  return segmentMatchesBounds(start, end, marqueeBounds(marquee));
}

export function memberIdsInMarquee(state, marquee) {
  const bounds = marqueeBounds(marquee);
  if (!bounds) return [];
  return state.members.filter(member => state.isMemberSelectable(member) &&
    segmentMatchesBounds(state.getNode(member.startNodeId), state.getNode(member.endNodeId), bounds))
    .map(member => member.id);
}
