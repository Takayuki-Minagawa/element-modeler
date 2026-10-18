import { validateExchange } from '../analysis/exchange.js';

// Internal history snapshots deliberately bypass CAD serialization: CAD files
// omit unused definitions and merge catalogs on load; undo must do neither.
// Private indexes/caches are derived data, never snapshot payload. The state
// owns their initialization via invalidateDerivedCaches() when present.
const isDerived = key => /^_.*(?:index|cache)/i.test(key);
const arrayFields = ['nodes', 'members', 'surfaces', 'loads', 'supports', 'levels',
  'axes', 'loadCombinations', 'materialCatalog', 'sectionCatalog', 'springCatalog'];

export function captureSnapshot(state) {
  const data = Object.fromEntries(Object.entries(state).filter(([key]) => !isDerived(key)));
  return { format: 'element-modeler-history', version: 1, data: structuredClone(data) };
}

export function restoreSnapshot(state, snapshot, { rollback = false } = {}) {
  if (snapshot?.format !== 'element-modeler-history' || snapshot.version !== 1 ||
      !snapshot.data || typeof snapshot.data !== 'object' || Array.isArray(snapshot.data)) {
    throw new Error('Invalid history snapshot');
  }
  if (!Number.isFinite(snapshot.data.revision) ||
      !Number.isInteger(snapshot.data.schemaVersion) ||
      arrayFields.some(key => !Array.isArray(snapshot.data[key])) ||
      ['meta', 'settings', 'analysisSettings'].some(key =>
        !snapshot.data[key] || typeof snapshot.data[key] !== 'object' || Array.isArray(snapshot.data[key]))) {
    throw new Error('Invalid history snapshot data');
  }
  // Finish cloning before touching live state or the history stacks.
  const data = structuredClone(snapshot.data);
  data.analysisExchange = (data.analysisExchange === null || data.analysisExchange === undefined) ? null : validateExchange(data.analysisExchange);
  for (const key of Object.keys(data)) if (isDerived(key)) delete data[key];
  if (!rollback) data.revision = state.revision + 1;
  const restored = Object.assign(Object.create(Object.getPrototypeOf(state)), data);
  restored.invalidateDerivedCaches?.();
  for (const key of Object.keys(state)) {
    if (!Object.hasOwn(restored, key)) delete state[key];
  }
  Object.assign(state, restored);
}

// Recovery keeps every custom definition, including unused ones. Runtime
// selection/tool state stays local and is reset on recovery, like CAD loading.
export function captureRecoveryData(state) {
  return structuredClone({
    ...state.toJSON(),
    materialCatalog: state.materialCatalog,
    sectionCatalog: state.sectionCatalog,
    springCatalog: state.springCatalog,
  });
}
