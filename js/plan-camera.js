// Pixels per millimeter. Keep fitting and wheel navigation in the same range,
// including large imported drawings and the coordinate input's ±1e9 mm range.
export const MIN_PLAN_SCALE = 1e-9;
export const MAX_PLAN_SCALE = 1;

export function clampPlanScale(scale) {
  return Math.max(MIN_PLAN_SCALE, Math.min(MAX_PLAN_SCALE, scale));
}

export function fitPlanToPoints(canvas, points) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const point of points) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return false;
  const width = canvas.logicalWidth || 600;
  const height = canvas.logicalHeight || 400;
  const spanX = Math.max(2000, maxX - minX);
  const spanY = Math.max(2000, maxY - minY);
  canvas.camera.scale = clampPlanScale(Math.min(width * 0.7 / spanX, height * 0.7 / spanY));
  canvas.camera.offsetX = width / 2 - (minX + maxX) / 2 * canvas.camera.scale;
  canvas.camera.offsetY = height / 2 + (minY + maxY) / 2 * canvas.camera.scale;
  return true;
}
