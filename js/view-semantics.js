// view-semantics.js - shared 2D/3D interpretation of model elements.
// These helpers keep the 2D canvas and the 3D viewer in agreement on how a
// support, a V-brace or a wall offset should be read from the model data.

import { WALL_DISPLAY_OFFSET_MM } from './constants.js';
import { resolveSpringStiffness } from './section-catalog.js';

// The model uses local y for strong-axis bending. Directional spring values
// override the common kr; an unspecified spring still displays as a spring.
export function beamStrongAxisEndCondition(end, spring) {
  if (end?.condition === 'rigid') return 'rigid';
  if (end?.condition !== 'spring') return 'pin';
  const stiffness = resolveSpringStiffness(spring).krY;
  return stiffness === 'pin' || stiffness === 'rigid' ? stiffness : 'spring';
}

// A support is drawn as "fixed" only when every translational and every
// rotational DOF is restrained. Any free DOF reads as a roller / partial
// support. Mirrors the allTrans && allRot test used by both renderers.
export function isFixedSupport(support) {
  const allTrans = support?.dx && support?.dy && support?.dz;
  const allRot = support?.rx && support?.ry && support?.rz;
  return Boolean(allTrans && allRot);
}

// Diagonal end-point index pairs for a V-brace panel drawn across a
// rectangular frame whose corners are indexed in this order:
//   0 = start-bottom, 1 = end-bottom, 2 = end-top, 3 = start-top
// A 'cross' pattern draws both diagonals (X); anything else draws the single
// start-bottom -> end-top diagonal. Both renderers build their corner array in
// this order before selecting diagonals, so the choice stays consistent.
export function braceDiagonals(pattern) {
  if (pattern === 'cross') return [[0, 2], [1, 3]];
  return [[0, 2]];
}

// The plan-view display offset (mm) applied to walls so that coincident wall
// lines do not overdraw their host beams. Falls back to the shared default.
export function resolveWallDisplayOffset(settings) {
  return settings?.wallDisplayOffset || WALL_DISPLAY_OFFSET_MM;
}
