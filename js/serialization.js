// serialization.js - Model save/load (toJSON / loadJSON) extracted from
// state.js. Functions take the AppState instance as their first argument;
// AppState keeps thin delegating methods with the same public API.

import { DEFAULT_ROOF_GROUP_ID, DEFAULT_SECTION_B_MM, DEFAULT_SECTION_H_MM } from './constants.js';
import { normalizeAnalysisSettings } from './analysis-settings.js';
import { normalizeSettings } from './display-settings.js';
import { positiveNumber as sanitizePositiveNumber } from './geometry-utils.js';
import {
  cloneSection,
  hydrateMaterialCatalog,
  hydrateSectionCatalog,
  hydrateSpringCatalog,
  normalizeMaterialEntry,
} from './section-catalog.js';
import {
  createDefaultLevels,
  createDefaultLoadCombinations,
  defaultSurfaceDrawColor,
  isGableWallSurfaceType,
  isRoofSurfaceType,
  isSlopedSurfaceType,
  normalizeAxisEntry,
  normalizeLoadCase,
  normalizeLoadFactors,
  normalizeMemberGeometryMode,
  sanitizeOptionalNumber,
  sanitizeRoofGroupId,
  stripSurfaceFieldsForType,
} from './domain/model.js';

function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export const CURRENT_SCHEMA_VERSION = 14;
const SUPPORTED_SCHEMA_VERSIONS = new Set(
  Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1)
);

export function isSupportedSchemaVersion(version) {
  return Number.isInteger(version) && SUPPORTED_SCHEMA_VERSIONS.has(version);
}

function usedSectionCatalog(state) {
  const usedNames = new Set();
  for (const m of state.members) {
    if (m.sectionName) usedNames.add(m.sectionName);
  }
  for (const s of state.surfaces) {
    if (s.sectionName) usedNames.add(s.sectionName);
  }
  return state.sectionCatalog.filter(s => s.isDefault || usedNames.has(s.name));
}

function usedSpringCatalog(state) {
  const usedSymbols = new Set();
  for (const m of state.members) {
    if (m.endI?.condition === 'spring' && m.endI.springSymbol) usedSymbols.add(m.endI.springSymbol);
    if (m.endJ?.condition === 'spring' && m.endJ.springSymbol) usedSymbols.add(m.endJ.springSymbol);
  }
  for (const section of usedSectionCatalog(state)) {
    if (section.defaultEndI?.condition === 'spring' && section.defaultEndI.springSymbol) {
      usedSymbols.add(section.defaultEndI.springSymbol);
    }
    if (section.defaultEndJ?.condition === 'spring' && section.defaultEndJ.springSymbol) {
      usedSymbols.add(section.defaultEndJ.springSymbol);
    }
  }
  return state.springCatalog.filter(s => s.isDefault || usedSymbols.has(s.symbol));
}

// Element ids (member/surface/load/support) are included in the output so
// they survive save/load round-trips. loadModelJSON re-numbers elements only
// for older files that lack ids.
export function serializeModel(state) {
  return {
    schemaVersion: state.schemaVersion,
    meta: { ...state.meta },
    settings: { ...state.settings },
    levels: state.levels.map(l => ({ ...l })),
    axes: state.axes.map(a => ({ ...a })),
    loadCombinations: state.loadCombinations.map(c => ({ ...c, factors: { ...c.factors } })),
    analysisSettings: {
      ...state.analysisSettings,
      massSources: { ...state.analysisSettings.massSources },
    },
    underlay: state.underlay
      ? { name: state.underlay.name, entities: structuredClone(state.underlay.entities) }
      : null,
    nodes: state.nodes.map(n => ({ ...n })),
    materialCatalog: state.materialCatalog.map(material => ({ ...material })),
    sectionCatalog: usedSectionCatalog(state).map(s => cloneSection(s)),
    springCatalog: usedSpringCatalog(state).map(s => ({ ...s })),
    members: state.members.map(m => ({
      id: m.id,
      type: m.type,
      startNodeId: m.startNodeId,
      endNodeId: m.endNodeId,
      sectionName: m.sectionName,
      levelId: m.levelId,
      color: m.color,
      topLevelId: m.topLevelId,
      geometryMode: m.geometryMode,
      startZ: m.startZ,
      endZ: m.endZ,
      roofRole: m.roofRole,
      bracePattern: m.bracePattern,
      endI: { ...m.endI },
      endJ: { ...m.endJ },
    })),
    surfaces: state.surfaces.map(s => {
      const surface = {
        id: s.id,
        type: s.type,
        sectionName: s.sectionName,
        levelId: s.levelId,
        topLevelId: s.topLevelId,
        loadDirection: s.loadDirection,
        heightMode: s.heightMode,
        bottomOffset: s.bottomOffset,
        topOffset: s.topOffset,
        includeWind: s.includeWind,
        includeSeismicWeight: s.includeSeismicWeight,
        unitWeight: s.unitWeight,
        color: s.color,
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        shape: s.shape,
        points: Array.isArray(s.points) ? s.points.map(p => ({ ...p })) : null,
      };
      if (isSlopedSurfaceType(s.type)) {
        surface.roofSlope = s.roofSlope;
        surface.roofDirection = s.roofDirection;
        surface.roofBaseOffset = s.roofBaseOffset;
      }
      if (isRoofSurfaceType(s.type)) {
        surface.roofGroupId = sanitizeRoofGroupId(s.roofGroupId, DEFAULT_ROOF_GROUP_ID);
      }
      if (isGableWallSurfaceType(s.type)) {
        surface.gableStartTopOffset = s.gableStartTopOffset;
        surface.gableEndTopOffset = s.gableEndTopOffset;
      }
      return surface;
    }),
    loads: state.loads.map(l => ({ ...l, loadCase: normalizeLoadCase(l.loadCase) })),
    supports: state.supports.map(s => ({
      id: s.id,
      x: s.x,
      y: s.y,
      levelId: s.levelId,
      dx: s.dx,
      dy: s.dy,
      dz: s.dz,
      rx: s.rx,
      ry: s.ry,
      rz: s.rz,
    })),
  };
}

export function loadModelJSON(state, data) {
  const version = data?.schemaVersion || 1;
  if (!data || !isSupportedSchemaVersion(version)) {
    throw new Error('Unsupported schema version');
  }
  state.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.meta = { ...data.meta };
  state.settings = normalizeSettings(data.settings);
  state.levels = Array.isArray(data.levels) && data.levels.length > 0
    ? data.levels.map(l => ({ ...l }))
    : createDefaultLevels();
  state.activeLevelId = state.levels[0]?.id || 'L0';
  state.surfaceDraftTopLevelId = state.levels[1]?.id || state.activeLevelId;
  state.axes = (data.axes || [])
    .map((a, idx) => normalizeAxisEntry(a, `AX${idx + 1}`))
    .filter(Boolean);
  // A present-but-empty array is a deliberate "no combinations" state and is
  // preserved; only files without the field (schema < 11) get the defaults.
  state.loadCombinations = Array.isArray(data.loadCombinations)
    ? data.loadCombinations.map((c, idx) => ({
      id: c.id || `LC${idx + 1}`,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : `LC${idx + 1}`,
      factors: normalizeLoadFactors(c.factors),
    }))
    : createDefaultLoadCombinations();
  state.analysisSettings = normalizeAnalysisSettings(data.analysisSettings);
  state.underlay = data.underlay && Array.isArray(data.underlay.entities) && data.underlay.entities.length
    ? { name: sanitizeText(data.underlay.name) || 'underlay', entities: structuredClone(data.underlay.entities) }
    : null;
  state.nodes = (data.nodes || []).map(n => ({ ...n }));
  // Preserve current custom user definitions across CAD load
  const prevCustomMaterials = state.materialCatalog.filter(material => !material.isDefault);
  const prevCustomSections = state.sectionCatalog.filter(s => !s.isDefault);
  const prevCustomSprings = state.springCatalog.filter(s => !s.isDefault);
  const loadedMaterialNames = new Set(
    Array.isArray(data.materialCatalog)
      ? data.materialCatalog
        .map(material => normalizeMaterialEntry(material))
        .filter(Boolean)
        .map(material => material.name)
      : []
  );
  state.materialCatalog = hydrateMaterialCatalog(data.materialCatalog);
  for (const material of prevCustomMaterials) {
    if (loadedMaterialNames.has(material.name)) continue;
    const existingIndex = state.materialCatalog.findIndex(item => item.name === material.name);
    if (existingIndex >= 0) {
      state.materialCatalog[existingIndex] = { ...material };
    } else {
      state.materialCatalog.push({ ...material });
    }
  }
  state.sectionCatalog = hydrateSectionCatalog(data.sectionCatalog);
  state.springCatalog = hydrateSpringCatalog(data.springCatalog);
  for (const cs of prevCustomSections) {
    if (!state.sectionCatalog.some(s => s.target === cs.target && s.type === cs.type && s.name === cs.name)) {
      state.sectionCatalog.push(cloneSection(cs));
    }
  }
  for (const cs of prevCustomSprings) {
    if (!state.springCatalog.some(s => s.symbol === cs.symbol)) {
      state.springCatalog.push({ ...cs });
    }
  }
  state._normalizeSectionCatalogEndDefaults();
  // Saved element ids are reused when present; files from older versions
  // without ids fall back to sequential re-numbering.
  state.members = (data.members || []).map((m, idx) =>
    normalizeLoadedMember(state, { id: m.id || `M${idx + 1}`, ...m })
  );
  state.surfaces = (data.surfaces || []).map((s, idx) =>
    normalizeLoadedSurface(state, { id: s.id || `S${idx + 1}`, ...s })
  );
  state.loads = (data.loads || []).map((l, idx) => ({
    id: l.id || `LD${idx + 1}`,
    ...l,
    loadCase: normalizeLoadCase(l.loadCase),
  }));
  state.supports = (data.supports || []).map((s, idx) => ({
    id: s.id || `SUP${idx + 1}`,
    x: s.x || 0,
    y: s.y || 0,
    levelId: s.levelId || state.activeLevelId || 'L0',
    dx: !!s.dx,
    dy: !!s.dy,
    dz: !!s.dz,
    rx: !!s.rx,
    ry: !!s.ry,
    rz: !!s.rz,
  }));
  state.resetRuntimeState();

  // Restore ID counters to the maximum restored id so the next issued id
  // (max + 1) never collides with a loaded element.
  state._nodeCounter = maxIdNum(state.nodes);
  state._memberCounter = maxIdNum(state.members);
  state._surfaceCounter = maxIdNum(state.surfaces);
  state._levelCounter = maxIdNum(state.levels);
  state._loadCounter = maxIdNumPrefix(state.loads, 'LD');
  state._supportCounter = maxIdNumPrefix(state.supports, 'SUP');
  state._axisCounter = maxIdNumPrefix(state.axes, 'AX');
  state._loadComboCounter = maxIdNumPrefix(state.loadCombinations, 'LC');
  state._touch();
}

function normalizeLoadedMember(state, raw) {
  const member = {
    ...raw,
    type: raw.type || 'beam',
    sectionName: sanitizeText(raw.sectionName) || '',
    section: {
      b: sanitizePositiveNumber(raw.section?.b, DEFAULT_SECTION_B_MM),
      h: sanitizePositiveNumber(raw.section?.h, DEFAULT_SECTION_H_MM),
    },
    levelId: raw.levelId || state.activeLevelId || 'L0',
    material: sanitizeText(raw.material) || 'steel',
    color: raw.color || '#666666',
    topLevelId: raw.topLevelId || null,
    geometryMode: normalizeMemberGeometryMode(raw.geometryMode),
    startZ: sanitizeOptionalNumber(raw.startZ),
    endZ: sanitizeOptionalNumber(raw.endZ),
    roofRole: sanitizeText(raw.roofRole) || null,
    bracePattern: raw.bracePattern || 'single',
    endI: state._normalizeMemberEnd(raw.endI || raw.iEnd),
    endJ: state._normalizeMemberEnd(raw.endJ || raw.jEnd),
  };

  const byName = member.sectionName ? state._getSectionRef('member', member.type, member.sectionName) : null;
  if (byName) {
    state._applyMemberSection(member, byName.name);
    return member;
  }

  const hasLegacySectionData = !!raw.section || !!raw.material;
  if (hasLegacySectionData) {
    const b = sanitizePositiveNumber(raw.section?.b, DEFAULT_SECTION_B_MM);
    const h = sanitizePositiveNumber(raw.section?.h, DEFAULT_SECTION_H_MM);
    const material = sanitizeText(raw.material) || 'steel';
    const section = state._findMemberSectionBySpec(member.type, material, b, h, member.color) ||
      state._createImportedMemberSection(member.type, material, b, h, member.color);
    state._applyMemberSection(member, section.name);
    return member;
  }

  state._ensureMemberSection(member, member.sectionName);
  return member;
}

function normalizeLoadedSurface(state, raw) {
  const type = raw.type || 'floor';
  const levelId = raw.levelId || state.activeLevelId || 'L0';
  const topLevelId = raw.topLevelId || state.surfaceDraftTopLevelId || state.getNextLevelId(levelId) || levelId;
  const surface = {
    ...raw,
    type,
    sectionName: sanitizeText(raw.sectionName) || '',
    levelId,
    topLevelId,
    loadDirection: raw.loadDirection || 'twoWay',
    color: raw.color || defaultSurfaceDrawColor(raw.type),
    shape: raw.shape || 'rect',
    points: Array.isArray(raw.points) ? raw.points.map(p => ({ ...p })) : null,
    ...state._normalizeSurfaceHeightAndWeight(type, levelId, topLevelId, raw),
    ...state._normalizeSurfaceRoof(type, raw),
  };
  Object.assign(surface, state._normalizeSurfaceGable(type, levelId, topLevelId, surface));
  stripSurfaceFieldsForType(surface, type);
  state._ensureSurfaceSection(surface, surface.sectionName);
  return surface;
}

function maxIdNum(items) {
  let max = 0;
  for (const item of items) {
    const n = parseTrailingIdNumber(item.id);
    if (n > max) max = n;
  }
  return max;
}

function maxIdNumPrefix(items, prefix) {
  let max = 0;
  for (const item of items) {
    const id = String(item.id ?? '');
    if (id.startsWith(prefix)) {
      const n = parseInt(id.slice(prefix.length), 10);
      if (n > max) max = n;
    }
  }
  return max;
}

function parseTrailingIdNumber(id) {
  if (typeof id === 'number' && Number.isFinite(id)) return Math.max(0, Math.floor(id));
  const text = String(id ?? '');
  const match = text.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}
