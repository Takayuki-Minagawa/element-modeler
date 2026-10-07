import { isSupportedSchemaVersion } from '../serialization.js';
import { hasProvisionalEdit } from '../domain/provisional-edit.js';
import { captureSnapshot, restoreSnapshot } from './snapshot.js';

const ARRAYS = ['levels', 'axes', 'nodes', 'members', 'surfaces', 'loads', 'supports',
  'loadCombinations', 'materialCatalog', 'sectionCatalog', 'springCatalog'];
const ELEMENTS = ['nodes', 'members', 'surfaces', 'loads', 'supports', 'levels', 'axes', 'loadCombinations'];

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
}

function id(value, path) {
  if (!(typeof value === 'string' && value.trim()) &&
      !(typeof value === 'number' && Number.isFinite(value))) {
    throw new Error(`${path} must be a non-empty ID`);
  }
}

function records(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  value.forEach((item, index) => object(item, `${path}[${index}]`));
}

// Validate structure before the existing legacy normalizers run. Optional
// fields may be absent in older CAD files, but present malformed fields are
// never silently interpreted as an empty model/catalog.
export function validateModelStructure(data) {
  object(data, 'Model');
  if (!isSupportedSchemaVersion(data.schemaVersion === undefined ? 1 : data.schemaVersion)) {
    throw new Error('Unsupported schema version');
  }
  for (const key of ARRAYS) {
    if (Object.hasOwn(data, key)) records(data[key], key);
  }
  for (const key of ['meta', 'settings', 'analysisSettings']) {
    if (Object.hasOwn(data, key)) object(data[key], key);
  }
  for (const key of ELEMENTS) {
    const seen = new Set();
    for (const item of data[key] || []) {
      if (item.id !== undefined || key === 'nodes' || key === 'levels') {
        id(item.id, `${key}.id`);
        if (seen.has(item.id)) throw new Error(`Duplicate ${key} ID: ${item.id}`);
        seen.add(item.id);
      }
      for (const ref of ['levelId', 'topLevelId', 'startNodeId', 'endNodeId']) {
        if (item[ref] !== null && item[ref] !== undefined) id(item[ref], `${key}.${ref}`);
      }
    }
  }
  for (const node of data.nodes || []) {
    for (const key of ['x', 'y']) {
      if (!Number.isFinite(node[key])) throw new Error(`nodes.${key} must be a finite number`);
    }
  }
  for (const [key, label] of [['materialCatalog', 'name'], ['sectionCatalog', 'name'], ['springCatalog', 'symbol']]) {
    for (const entry of data[key] || []) {
      if (typeof entry[label] !== 'string' || !entry[label].trim()) throw new Error(`${key}.${label} is required`);
    }
  }
  for (const entry of data.sectionCatalog || []) {
    if (!['member', 'surface'].includes(entry.target) || typeof entry.type !== 'string' || !entry.type.trim()) {
      throw new Error('Invalid sectionCatalog target/type');
    }
  }
  for (const member of data.members || []) {
    for (const key of ['endI', 'endJ', 'iEnd', 'jEnd', 'section']) {
      if (member[key] !== null && member[key] !== undefined) object(member[key], `members.${key}`);
    }
  }
  for (const surface of data.surfaces || []) {
    if (surface.points !== null && surface.points !== undefined) {
      records(surface.points, 'surfaces.points');
      for (const point of surface.points) {
        if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('Invalid surface point');
      }
    }
  }
  if (data.underlay !== null && data.underlay !== undefined) {
    object(data.underlay, 'underlay');
    records(data.underlay.entities, 'underlay.entities');
  }
}

function validateReferences(state) {
  // Check normalized IDs as well: legacy generated IDs can collide with an
  // explicitly supplied ID later in the same array.
  for (const key of ELEMENTS) {
    const seen = new Set();
    for (const item of state[key]) {
      id(item.id, `${key}.id`);
      if (seen.has(item.id)) throw new Error(`Duplicate ${key} ID: ${item.id}`);
      seen.add(item.id);
    }
  }
  const nodes = new Set(state.nodes.map(node => node.id));
  const levels = new Set(state.levels.map(level => level.id));
  for (const member of state.members) {
    for (const key of ['startNodeId', 'endNodeId']) {
      if (!nodes.has(member[key])) throw new Error(`Unknown ${key}: ${member[key]}`);
    }
  }
  for (const item of [...state.members, ...state.surfaces, ...state.loads, ...state.supports]) {
    for (const key of ['levelId', 'topLevelId']) {
      if (item[key] !== null && item[key] !== undefined && !levels.has(item[key])) throw new Error(`Unknown ${key}: ${item[key]}`);
    }
  }
}

export function prepareModelImport(data, state, { preserveCatalogs = true } = {}) {
  validateModelStructure(data);
  // Same prototype and independent data preserve the existing CAD catalog
  // merge rules without running any normalizer against the live model.
  const candidate = Object.assign(Object.create(Object.getPrototypeOf(state)), captureSnapshot(state).data);
  candidate.invalidateDerivedCaches?.();
  if (!preserveCatalogs) {
    candidate.materialCatalog = [];
    candidate.sectionCatalog = [];
    candidate.springCatalog = [];
  }
  candidate.loadJSON(structuredClone(data));
  validateReferences(candidate);
  return captureSnapshot(candidate);
}

export function applyModelImport(data, state, history, options) {
  // A pending file read can finish after a drag starts. Keep its preview out
  // of history and prevent stale drag originals from changing the new model.
  if (hasProvisionalEdit(state)) {
    throw new Error('Finish or cancel the current edit before importing a model');
  }
  const prepared = prepareModelImport(data, state, options);
  const apply = () => {
    restoreSnapshot(state, prepared);
    return true;
  };
  if (history) history.transact(apply, 'model-replacement');
  else apply();
  return data;
}
