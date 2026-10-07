// grid.js - Grid drawing and snap calculation

import { AXIS_SNAP_TOLERANCE_PX } from './constants.js';
import { cssVar } from './dom-utils.js';

// Origin legend layout (bottom-left corner), in screen px
const LEGEND_MARGIN = 20;
const LEGEND_SIZE = 60;
const LEGEND_AXIS_LENGTH = 40;
const LEGEND_ARROWHEAD_BACK = 5;
const LEGEND_ARROWHEAD_HALF_WIDTH = 4;
const LEGEND_ORIGIN_DOT_RADIUS = 4;
const LEGEND_LABEL_OFFSET = 50;
const LEGEND_LABEL_NUDGE = 5;

// Origin marker (at the world origin), in screen px
const ORIGIN_DOT_RADIUS = 4;
const ORIGIN_VISIBLE_MARGIN = 20;
const MIN_GRID_SPACING_PX = 12;

export function drawGrid(ctx, camera, gridSize, canvasW, canvasH) {
  ctx.save();
  drawGridLines(ctx, camera, gridSize, canvasW, canvasH);
  drawAxes(ctx, camera, canvasW, canvasH);
  drawOriginLegend(ctx, canvasH);
  ctx.restore();
}

function drawGridLines(ctx, camera, gridSize, canvasW, canvasH) {
  const { offsetX, offsetY, scale } = camera;
  if (!Number.isFinite(gridSize) || gridSize <= 0 || !Number.isFinite(scale) || scale <= 0) return;
  // Draw an integer multiple of the configured grid at low zoom. Snapping
  // still uses the original gridSize, while rendering stays bounded by pixels.
  const spacing = gridSize * Math.max(1, Math.ceil(MIN_GRID_SPACING_PX / (gridSize * scale)));

  // Calculate visible world bounds
  const worldLeft = -offsetX / scale;
  const worldRight = (canvasW - offsetX) / scale;
  const worldMinY = (offsetY - canvasH) / scale;
  const worldMaxY = offsetY / scale;

  // Grid line range
  const startX = Math.floor(worldLeft / spacing);
  const endX = Math.ceil(worldRight / spacing);
  const startY = Math.floor(worldMinY / spacing);
  const endY = Math.ceil(worldMaxY / spacing);

  ctx.strokeStyle = cssVar('--grid-line');
  ctx.lineWidth = 1;

  // Vertical lines
  for (let index = startX; index <= endX; index++) {
    const sx = index * spacing * scale + offsetX;
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, canvasH);
    ctx.stroke();
  }

  // Horizontal lines
  for (let index = startY; index <= endY; index++) {
    const sy = offsetY - index * spacing * scale;
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(canvasW, sy);
    ctx.stroke();
  }
}

function drawAxes(ctx, camera, canvasW, canvasH) {
  const { offsetX, offsetY } = camera;

  // X axis
  ctx.strokeStyle = cssVar('--grid-axis-x');
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, offsetY);
  ctx.lineTo(canvasW, offsetY);
  ctx.stroke();

  // Y axis
  ctx.strokeStyle = cssVar('--grid-axis-y');
  ctx.beginPath();
  ctx.moveTo(offsetX, 0);
  ctx.lineTo(offsetX, canvasH);
  ctx.stroke();

  // Origin marker (circle at origin)
  const originX = offsetX;
  const originY = offsetY;
  if (originX >= -ORIGIN_VISIBLE_MARGIN && originX <= canvasW + ORIGIN_VISIBLE_MARGIN &&
      originY >= -ORIGIN_VISIBLE_MARGIN && originY <= canvasH + ORIGIN_VISIBLE_MARGIN) {
    ctx.fillStyle = cssVar('--grid-axis-x');
    ctx.beginPath();
    ctx.arc(originX, originY, ORIGIN_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Origin reference and axis labels in the bottom-left corner
function drawOriginLegend(ctx, canvasH) {
  const originRefX = LEGEND_MARGIN + LEGEND_SIZE / 2;
  const originRefY = canvasH - LEGEND_MARGIN - LEGEND_SIZE / 2;

  // Origin point
  ctx.fillStyle = cssVar('--grid-axis-x');
  ctx.beginPath();
  ctx.arc(originRefX, originRefY, LEGEND_ORIGIN_DOT_RADIUS, 0, Math.PI * 2);
  ctx.fill();

  // X axis arrow (to the right)
  ctx.strokeStyle = cssVar('--grid-axis-x');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(originRefX, originRefY);
  ctx.lineTo(originRefX + LEGEND_AXIS_LENGTH, originRefY);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(originRefX + LEGEND_AXIS_LENGTH, originRefY);
  ctx.lineTo(originRefX + LEGEND_AXIS_LENGTH - LEGEND_ARROWHEAD_BACK, originRefY - LEGEND_ARROWHEAD_HALF_WIDTH);
  ctx.lineTo(originRefX + LEGEND_AXIS_LENGTH - LEGEND_ARROWHEAD_BACK, originRefY + LEGEND_ARROWHEAD_HALF_WIDTH);
  ctx.closePath();
  ctx.fillStyle = cssVar('--grid-axis-x');
  ctx.fill();

  // Y axis arrow (upward)
  ctx.strokeStyle = cssVar('--grid-axis-y');
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(originRefX, originRefY);
  ctx.lineTo(originRefX, originRefY - LEGEND_AXIS_LENGTH);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(originRefX, originRefY - LEGEND_AXIS_LENGTH);
  ctx.lineTo(originRefX - LEGEND_ARROWHEAD_HALF_WIDTH, originRefY - LEGEND_AXIS_LENGTH + LEGEND_ARROWHEAD_BACK);
  ctx.lineTo(originRefX + LEGEND_ARROWHEAD_HALF_WIDTH, originRefY - LEGEND_AXIS_LENGTH + LEGEND_ARROWHEAD_BACK);
  ctx.closePath();
  ctx.fillStyle = cssVar('--grid-axis-y');
  ctx.fill();

  // Labels (offset to avoid overlap with members)
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = cssVar('--grid-axis-x');
  ctx.fillText('X', originRefX + LEGEND_LABEL_OFFSET, originRefY + LEGEND_LABEL_NUDGE);

  ctx.fillStyle = cssVar('--grid-axis-y');
  ctx.fillText('Y', originRefX - LEGEND_LABEL_NUDGE, originRefY - LEGEND_LABEL_OFFSET);
}

export function snapToGrid(x, y, gridSize) {
  return {
    x: Math.round(x / gridSize) * gridSize,
    y: Math.round(y / gridSize) * gridSize,
  };
}

export function snapToNode(x, y, state, tolerance) {
  const node = state.findNodeAt(x, y, tolerance);
  if (node) return { x: node.x, y: node.y, nodeId: node.id };
  return null;
}

// Nearest axis (通り芯) coordinate for one plan direction within tolerance,
// or null. dir 'x' axes constrain the X coordinate, 'y' axes the Y coordinate.
export function snapToAxisCoord(value, dir, state, tolerance) {
  if (!state.settings.showAxes) return null;
  let best = null;
  let bestDist = tolerance;
  for (const axis of state.axes || []) {
    if (axis.dir !== dir) continue;
    const d = Math.abs(axis.coord - value);
    if (d < bestDist) {
      bestDist = d;
      best = axis.coord;
    }
  }
  return best;
}

export function applySnap(worldX, worldY, state, camera) {
  if (!state.settings.snap) return { x: worldX, y: worldY };

  const tolerance = 10 / camera.scale; // ~10 screen pixels in world mm

  const nodeSnap = snapToNode(worldX, worldY, state, tolerance);
  if (nodeSnap) return nodeSnap;

  // Axis lines snap per coordinate, so axis intersections snap naturally;
  // the other coordinate falls back to the grid.
  const axisTolerance = AXIS_SNAP_TOLERANCE_PX / camera.scale;
  const axisX = snapToAxisCoord(worldX, 'x', state, axisTolerance);
  const axisY = snapToAxisCoord(worldY, 'y', state, axisTolerance);
  const grid = snapToGrid(worldX, worldY, state.settings.gridSize);
  return {
    x: axisX !== null ? axisX : grid.x,
    y: axisY !== null ? axisY : grid.y,
  };
}
