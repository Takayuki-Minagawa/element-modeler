// Pure merge planning. The first surviving node in numeric ID order wins;
// proximity is deliberately not transitive (A near B near C need not merge C).
function bruteForceRemap(nodes, tolerance) {
  const remap = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const target = nodes[i];
    if (remap.has(target.id)) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const other = nodes[j];
      if (remap.has(other.id)) continue;
      if (Math.hypot(other.x - target.x, other.y - target.y) <= tolerance) {
        remap.set(other.id, target.id);
      }
    }
  }
  return remap;
}

export function planNearbyNodeMerge(input, tolerance) {
  const nodes = [...input].sort((a, b) => a.id - b.id);
  // Twice the radius gives rounding headroom at cell boundaries. Extremely
  // large cell coordinates, non-numeric coordinates and duplicate IDs retain
  // the original scan semantics instead of relying on an unsafe grid index.
  const cellSize = tolerance * 2;
  const cells = nodes.map(node => [Math.floor(node.x / cellSize), Math.floor(node.y / cellSize)]);
  if (!(tolerance > 0) || !Number.isFinite(cellSize) ||
      new Set(nodes.map(node => node.id)).size !== nodes.length ||
      nodes.some(node => !Number.isFinite(node.x) || !Number.isFinite(node.y)) ||
      cells.some(cell => cell.some(value => !Number.isSafeInteger(value) || Math.abs(value) > 2 ** 50))) {
    return bruteForceRemap(nodes, tolerance);
  }

  const buckets = new Map();
  const key = (x, y) => `${x}:${y}`;
  cells.forEach(([x, y], index) => {
    const cellKey = key(x, y);
    if (!buckets.has(cellKey)) buckets.set(cellKey, []);
    buckets.get(cellKey).push(index);
  });

  const remap = new Map();
  for (let i = 0; i < nodes.length; i++) {
    const target = nodes[i];
    if (remap.has(target.id)) continue;
    const [x, y] = cells[i];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const j of buckets.get(key(x + dx, y + dy)) || []) {
          if (j <= i) continue;
          const other = nodes[j];
          if (remap.has(other.id)) continue;
          // Keep the precise distance predicate from the original algorithm.
          if (Math.hypot(other.x - target.x, other.y - target.y) <= tolerance) {
            remap.set(other.id, target.id);
          }
        }
      }
    }
  }
  return remap;
}
