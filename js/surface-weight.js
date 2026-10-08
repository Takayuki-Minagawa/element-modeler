// Surface weights use kg/m³, mm, and N/m². A null result means that a
// density-derived total is not fully specified; the caller keeps its manual
// total instead of treating missing inputs as zero.
export const STANDARD_GRAVITY_M_S2 = 9.80665;

export function calculateSurfaceUnitWeight(section, material) {
  if (section?.selfWeightMode !== 'fromDensity') return null;
  const density = material?.density;
  const thickness = section.thickness;
  const additionalWeight = section.additionalWeight;
  if (!Number.isFinite(density) || density <= 0 ||
      !Number.isFinite(thickness) || thickness <= 0 ||
      !Number.isFinite(additionalWeight) || additionalWeight < 0) return null;
  const total = density * (thickness / 1000) * STANDARD_GRAVITY_M_S2 + additionalWeight;
  return Number.isFinite(total) ? total : null;
}
