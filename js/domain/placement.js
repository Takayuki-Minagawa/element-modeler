/** Shared by drawing and its guide; exterior walls always use a closed outline. */
export function surfacePlacementMode(type, draftMode) {
  if (type === 'exteriorWall') return 'polyline';
  if (type === 'wall' || type === 'gableWall') return 'line';
  return draftMode;
}
