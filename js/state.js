import { catalogState } from './state/catalog.js';
import { runtimeState } from './state/runtime.js';
import { createIdIndex, indexedItem } from './domain/id-index.js';
import {
  createDefaultLevels,
  normalizeLoadCase,
  normalizeLoadFactors,
  createDefaultLoadCombinations,
  hasOwn,
  sanitizePatchFields,
  stripSurfaceFieldsForType,
  sanitizeOptionalNumber,
  sanitizeText,
  sanitizeRoofGroupId,
  defaultSurfaceDrawColor,
  normalizeSurfaceHeightMode,
  normalizeMemberGeometryMode,
  isWallSurfaceType,
  isRoofSurfaceType,
  isGableWallSurfaceType,
  isSlopedSurfaceType,
} from './domain/model.js';
export {
  createDefaultLevels,
  normalizeLoadCase,
  normalizeLoadFactors,
  createDefaultLoadCombinations,
  normalizeAxisEntry,
  stripSurfaceFieldsForType,
  sanitizeOptionalNumber,
  sanitizeRoofGroupId,
  defaultSurfaceDrawColor,
  normalizeMemberGeometryMode,
  isWallSurfaceType,
  isRoofSurfaceType,
  isGableWallSurfaceType,
  isEaveSurfaceType,
  isSlopedSurfaceType,
} from './domain/model.js';
// state.js - Data model and state management

import {
  DEFAULT_ROOF_GROUP_ID,
  DEFAULT_ROOF_SLOPE_RATIO,
  DEFAULT_SECTION_B_MM,
  DEFAULT_SECTION_H_MM,
  DEFAULT_STORY_HEIGHT_MM,
  HANGING_WALL_DEPTH_MM,
  HIT_TOLERANCE_MM,
  WAIST_WALL_TOP_OFFSET_MM,
  WALL_DISPLAY_OFFSET_MM,
} from './constants.js';
import {
  finiteNumber as sanitizeNumber,
  nonNegativeNumber as sanitizeNonNegativeNumber,
  offsetPolygonOutward,
  pointInPolygon,
  pointToSegmentDist,
  positiveNumber as sanitizePositiveNumber,
} from './geometry-utils.js';
import {
  createDefaultSettings,
  displayPresetSettings,
  normalizeDisplayPreset,
  normalizePlanLayerDisplayMode,
} from './display-settings.js';
import * as modelOps from './model-ops.js';
import { normalizeRoofDirection } from './roof-geometry.js';
import * as roofGen from './roof-generation.js';
import {
  createDefaultAnalysisSettings,
  normalizeAnalysisSettings,
} from './analysis-settings.js';
import {
  createDefaultMaterialCatalog,
  createDefaultSectionCatalog,
  createDefaultSpringCatalog,
} from './section-catalog.js';
import { CURRENT_SCHEMA_VERSION, loadModelJSON, serializeModel } from './serialization.js';

// Re-exported for API compatibility (implementations in display-settings.js)
export {
  createDefaultSettings,
  GRID_SIZE_DEFAULT,
  GRID_SIZE_MAX,
  GRID_SIZE_MIN,
  normalizeBeam3DSectionMode,
  normalizeGridSize,
  normalizeSettings,
} from './display-settings.js';

// Per-field sanitizers applied to updateSurface() patches. Each receives the
// raw patch value and the current surface (for fallbacks).
const SURFACE_PATCH_SANITIZERS = {
  heightMode: value => normalizeSurfaceHeightMode(value),
  bottomOffset: (value, surface) => sanitizeNumber(value, surface.bottomOffset || 0),
  topOffset: (value, surface) => sanitizeNumber(value, surface.topOffset || 0),
  unitWeight: (value, surface) => sanitizeNonNegativeNumber(value, surface.unitWeight || 0),
  includeWind: value => !!value,
  includeSeismicWeight: value => !!value,
  roofSlope: (value, surface) => sanitizeNonNegativeNumber(value, surface.roofSlope || 0),
  roofDirection: value => normalizeRoofDirection(value),
  roofBaseOffset: (value, surface) => sanitizeNumber(value, surface.roofBaseOffset || 0),
  roofGroupId: (value, surface) => sanitizeRoofGroupId(value, surface.roofGroupId || DEFAULT_ROOF_GROUP_ID),
  gableStartTopOffset: (value, surface) => sanitizeNumber(
    value,
    hasOwn(surface, 'gableStartTopOffset') ? surface.gableStartTopOffset : surface.topOffset
  ),
  gableEndTopOffset: (value, surface) => sanitizeNumber(
    value,
    hasOwn(surface, 'gableEndTopOffset') ? surface.gableEndTopOffset : surface.topOffset
  ),
};

// Per-field sanitizers applied to updateMember() patches.
const MEMBER_PATCH_SANITIZERS = {
  geometryMode: value => normalizeMemberGeometryMode(value),
  startZ: value => sanitizeOptionalNumber(value),
  endZ: value => sanitizeOptionalNumber(value),
  roofRole: value => sanitizeText(value) || null,
};

export class AppState {
  constructor() {
    this.schemaVersion = CURRENT_SCHEMA_VERSION;
    this.meta = {
      name: 'untitled',
      unit: 'mm',
      createdAt: new Date().toISOString(),
    };
    this.settings = createDefaultSettings();
    this.levels = createDefaultLevels();
    this.nodes = [];
    this.members = [];
    this.surfaces = [];
    this.loads = [];
    this.supports = [];
    this.materialCatalog = createDefaultMaterialCatalog();
    this.sectionCatalog = createDefaultSectionCatalog();
    this.springCatalog = createDefaultSpringCatalog();
    this.axes = [];
    this.loadCombinations = createDefaultLoadCombinations();
    this.analysisSettings = createDefaultAnalysisSettings();
    // Optional imported drawing underlay ({ name, entities }) shown beneath
    // the plan; not part of the structural model.
    this.underlay = null;

    // Monotonic model revision counter; bumped by _touch() whenever a public
    // method mutates the model. Not serialized.
    this.revision = 0;

    // Runtime state (not serialized)
    this.activeLevelId = 'L0';
    this.surfaceDraftTopLevelId = 'L1';
    this.resetRuntimeState();

    // Counters for ID generation
    this._nodeCounter = 0;
    this._memberCounter = 0;
    this._surfaceCounter = 0;
    this._levelCounter = 1;
    this._loadCounter = 0;
    this._supportCounter = 0;
    this._axisCounter = 0;
    this._loadComboCounter = this.loadCombinations.length;
    this.invalidateDerivedCaches();
  }

  // Bumps the model revision. Called by every mutating public method.
  _touch() {
    this.revision += 1;
    this.invalidateDerivedCaches();
  }

  // Derived lookup data is never part of CAD or history payloads. Snapshot
  // restore calls this hook; array identity/length also guard direct edits.
  invalidateDerivedCaches() {
    this._idIndexes = null;
  }

  _getById(collection, id) {
    const items = this[collection];
    this._idIndexes ||= new Map();
    let index = this._idIndexes.get(collection);
    if (!index || index.items !== items || index.length !== items.length) {
      index = createIdIndex(items);
      this._idIndexes.set(collection, index);
      return index.entries.get(id)?.item;
    }
    const item = indexedItem(index, items, id);
    if (item && index.entries.get(id)?.item !== item) {
      index = createIdIndex(items);
      this._idIndexes.set(collection, index);
    }
    return item;
  }

  // Settings are persisted with the model, so edits must bump the revision —
  // otherwise a settings-only change would never reach the autosave snapshot.
  updateSetting(key, value) {
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this._touch();
  }

  updateAnalysisSettings(props = {}) {
    const candidate = {
      ...this.analysisSettings,
      ...props,
      massSources: {
        ...this.analysisSettings.massSources,
        ...(props.massSources || {}),
      },
    };
    const next = normalizeAnalysisSettings(candidate);
    if (JSON.stringify(next) === JSON.stringify(this.analysisSettings)) return false;
    this.analysisSettings = next;
    this._touch();
    return true;
  }

  // Resets selection, tool, and draft state to the initial defaults.
  // activeLevelId / surfaceDraftTopLevelId are intentionally excluded: they
  // are derived from the level list by the constructor and loadJSON.
  resetRuntimeState(...args) {
    return runtimeState.resetRuntimeState.apply(this, args);
  }

  // --- Selection ---

  // Selects a single element, clearing every other selection first.
  // kind: 'node' | 'member' | 'surface' | 'load' | 'support'.
  // Passing a null/undefined id (or kind) clears all selections.
  select(...args) {
    return runtimeState.select.apply(this, args);
  }

  clearSelection(...args) {
    return runtimeState.clearSelection.apply(this, args);
  }

  // Selection applied after a draw tool creates an element: the new element
  // becomes the only selection of any kind (single- and multi-select member
  // fields stay in sync). Clearing the support selection too keeps Delete
  // acting on the element the user just drew, never on a stale support.
  selectDrawn(...args) {
    return runtimeState.selectDrawn.apply(this, args);
  }

  // --- Multi-selection (members) ---

  // Replaces the member selection with the given ids (other kinds cleared).
  selectMembers(...args) {
    return runtimeState.selectMembers.apply(this, args);
  }

  // Adds or removes one member from the multi-selection (Shift+click).
  toggleMemberSelection(...args) {
    return runtimeState.toggleMemberSelection.apply(this, args);
  }

  isMemberSelected(...args) {
    return runtimeState.isMemberSelected.apply(this, args);
  }

  // --- Section & Spring catalogs ---

  _normalizeSectionType(...args) {
    return catalogState._normalizeSectionType.apply(this, args);
  }

  _getSectionRef(...args) {
    return catalogState._getSectionRef.apply(this, args);
  }

  getSection(...args) {
    return catalogState.getSection.apply(this, args);
  }

  listSections(...args) {
    return catalogState.listSections.apply(this, args);
  }

  getDefaultSectionName(...args) {
    return catalogState.getDefaultSectionName.apply(this, args);
  }

  getDefaultSection(...args) {
    return catalogState.getDefaultSection.apply(this, args);
  }

  _draftSectionStore(...args) {
    return runtimeState._draftSectionStore.apply(this, args);
  }

  // Returns the sticky ("paste") section for a type if one is set and still
  // exists, otherwise falls back to the built-in default section.
  getDraftSectionName(...args) {
    return runtimeState.getDraftSectionName.apply(this, args);
  }

  // Sets (or clears) the sticky section for a type. Passing a falsy/unknown
  // name clears it so subsequent draws revert to the built-in default.
  setDraftSectionName(...args) {
    return runtimeState.setDraftSectionName.apply(this, args);
  }

  getLevelZ(levelId) {
    const level = this.levels.find(l => l.id === levelId);
    return Number.isFinite(Number(level?.z)) ? Number(level.z) : 0;
  }

  getNextLevelId(levelId = this.activeLevelId) {
    const sortedLevels = [...this.levels].sort((a, b) => a.z - b.z);
    const activeIdx = sortedLevels.findIndex(l => l.id === levelId);
    if (activeIdx < 0 || activeIdx >= sortedLevels.length - 1) return null;
    return sortedLevels[activeIdx + 1].id;
  }

  getStoryHeight(levelId = this.activeLevelId, topLevelId = null) {
    const resolvedTopLevelId = topLevelId || this.getNextLevelId(levelId);
    if (!resolvedTopLevelId) return 0;
    return Math.max(0, this.getLevelZ(resolvedTopLevelId) - this.getLevelZ(levelId));
  }

  getPlanLayerStyle(levelId, options = {}) {
    const mode = normalizePlanLayerDisplayMode(
      options.view === '3d'
        ? (this.settings?.view3dLayerDisplayMode || this.settings?.planLayerDisplayMode)
        : this.settings?.planLayerDisplayMode
    );
    const targetLevelId = levelId || this.activeLevelId || 'L0';
    const isActive = targetLevelId === this.activeLevelId;
    const lockOtherLayers = options.view !== '3d' && !!this.settings?.planLayerSelectionLock;
    if (mode === 'current' && !isActive) {
      return { visible: false, alpha: 0, halftone: false, selectable: false };
    }
    if (mode === 'halftone' && !isActive) {
      return { visible: true, alpha: 0.28, halftone: true, selectable: !lockOtherLayers };
    }
    return { visible: true, alpha: 1, halftone: false, selectable: true };
  }

  isMemberVisible(member, view = '2d') {
    if (this.settings?.showMembers === false) return false;
    if (!member) return false;
    const layerStyle = this.getPlanLayerStyle(member.levelId, { view });
    if (!layerStyle.visible) return false;
    const typeFilter = sanitizeText(this.settings?.memberTypeFilter) || 'all';
    if (typeFilter !== 'all' && member.type !== typeFilter) return false;
    const sectionFilter = sanitizeText(this.settings?.sectionFilter) || 'all';
    if (sectionFilter !== 'all' && member.sectionName !== sectionFilter) return false;
    return true;
  }

  isSurfaceVisible(surface, view = '2d') {
    if (this.settings?.showSurfaces === false) return false;
    if (!surface) return false;
    return this.getPlanLayerStyle(surface.levelId, { view }).visible;
  }

  isLoadVisible(load, view = '2d') {
    if (this.settings?.showLoads === false) return false;
    if (!load) return false;
    return this.getPlanLayerStyle(load.levelId, { view }).visible;
  }

  isSupportVisible(support, view = '2d') {
    if (this.settings?.showSupports === false) return false;
    if (!support) return false;
    return this.getPlanLayerStyle(support.levelId, { view }).visible;
  }

  isMemberSelectable(member) {
    return this.isMemberVisible(member, '2d') && this.getPlanLayerStyle(member.levelId).selectable;
  }

  isSurfaceSelectable(surface) {
    return this.isSurfaceVisible(surface, '2d') && this.getPlanLayerStyle(surface.levelId).selectable;
  }

  isLoadSelectable(load) {
    return this.isLoadVisible(load, '2d') && this.getPlanLayerStyle(load.levelId).selectable;
  }

  isSupportSelectable(support) {
    return this.isSupportVisible(support, '2d') && this.getPlanLayerStyle(support.levelId).selectable;
  }

  applyDisplayPreset(name) {
    const preset = normalizeDisplayPreset(name);
    this.settings.displayPreset = preset;
    Object.assign(this.settings, displayPresetSettings(preset));
    this._touch();
    return preset;
  }

  getSurfaceHeightOffsets(options = {}) {
    const heightMode = normalizeSurfaceHeightMode(options.heightMode);
    const levelId = options.levelId || this.activeLevelId || 'L0';
    const topLevelId = options.topLevelId || this.getNextLevelId(levelId) || this.surfaceDraftTopLevelId || levelId;
    const storyHeight = this.getStoryHeight(levelId, topLevelId);

    if (heightMode === 'waist') {
      return {
        heightMode,
        bottomOffset: 0,
        topOffset: Math.min(WAIST_WALL_TOP_OFFSET_MM, storyHeight || WAIST_WALL_TOP_OFFSET_MM),
      };
    }

    if (heightMode === 'hanging') {
      const topOffset = storyHeight || 0;
      return {
        heightMode,
        bottomOffset: Math.max(0, topOffset - HANGING_WALL_DEPTH_MM),
        topOffset,
      };
    }

    if (heightMode === 'custom') {
      const bottomOffset = sanitizeNumber(options.bottomOffset, this.surfaceDraftBottomOffset || 0);
      const fallbackTopOffset = Math.max(bottomOffset + 1, this.surfaceDraftTopOffset || storyHeight || WAIST_WALL_TOP_OFFSET_MM);
      const topOffset = sanitizeNumber(options.topOffset, fallbackTopOffset);
      return {
        heightMode,
        bottomOffset,
        topOffset: topOffset > bottomOffset ? topOffset : fallbackTopOffset,
      };
    }

    return {
      heightMode: 'full',
      bottomOffset: 0,
      topOffset: storyHeight || 0,
    };
  }

  addSection(...args) {
    return catalogState.addSection.apply(this, args);
  }

  updateSection(...args) {
    return catalogState.updateSection.apply(this, args);
  }

  removeSection(...args) {
    return catalogState.removeSection.apply(this, args);
  }

  _getSpringRef(...args) {
    return catalogState._getSpringRef.apply(this, args);
  }

  getSpring(...args) {
    return catalogState.getSpring.apply(this, args);
  }

  listSprings(...args) {
    return catalogState.listSprings.apply(this, args);
  }

  addSpring(...args) {
    return catalogState.addSpring.apply(this, args);
  }

  updateSpring(...args) {
    return catalogState.updateSpring.apply(this, args);
  }

  removeSpring(...args) {
    return catalogState.removeSpring.apply(this, args);
  }

  _getMaterialRef(...args) {
    return catalogState._getMaterialRef.apply(this, args);
  }

  getMaterial(...args) {
    return catalogState.getMaterial.apply(this, args);
  }

  listMaterials(...args) {
    return catalogState.listMaterials.apply(this, args);
  }

  addMaterial(...args) {
    return catalogState.addMaterial.apply(this, args);
  }

  updateMaterial(...args) {
    return catalogState.updateMaterial.apply(this, args);
  }

  removeMaterial(...args) {
    return catalogState.removeMaterial.apply(this, args);
  }

  _nextCustomSectionName(...args) {
    return catalogState._nextCustomSectionName.apply(this, args);
  }

  _findMemberSectionBySpec(...args) {
    return catalogState._findMemberSectionBySpec.apply(this, args);
  }

  _createImportedMemberSection(...args) {
    return catalogState._createImportedMemberSection.apply(this, args);
  }

  // Applies a catalog section to a member (name, material, b/h, color).
  // The single write path for section-driven member fields.
  _applyMemberSection(...args) {
    return catalogState._applyMemberSection.apply(this, args);
  }

  // Resolves the best catalog section for a member (requested name, then the
  // type default, then any section of the type) and applies it via
  // _applyMemberSection. Falls back to sanitizing inline values when the
  // catalog has no section for the type at all.
  _ensureMemberSection(...args) {
    return catalogState._ensureMemberSection.apply(this, args);
  }

  _getMemberSectionEndDefaults(...args) {
    return catalogState._getMemberSectionEndDefaults.apply(this, args);
  }

  _normalizeSectionEndDefaults(...args) {
    return catalogState._normalizeSectionEndDefaults.apply(this, args);
  }

  _normalizeSectionCatalogEndDefaults(...args) {
    return catalogState._normalizeSectionCatalogEndDefaults.apply(this, args);
  }

  _ensureSurfaceSection(...args) {
    return catalogState._ensureSurfaceSection.apply(this, args);
  }

  // Member-end normalization validated against this state's spring catalog.
  // (section-catalog.js normalizeSectionDefaultEnd is the catalog-free variant.)
  _normalizeMemberEnd(...args) {
    return catalogState._normalizeMemberEnd.apply(this, args);
  }

  _normalizeSurfaceHeightAndWeight(type, levelId, topLevelId, options = {}) {
    const isWallType = isWallSurfaceType(type);
    if (!isWallType) {
      return {
        heightMode: 'custom',
        bottomOffset: 0,
        topOffset: 0,
        includeWind: hasOwn(options, 'includeWind') ? !!options.includeWind : isSlopedSurfaceType(type),
        includeSeismicWeight: hasOwn(options, 'includeSeismicWeight') ? !!options.includeSeismicWeight : false,
        unitWeight: sanitizeNonNegativeNumber(options.unitWeight, 0),
      };
    }

    const offsets = this.getSurfaceHeightOffsets({
      heightMode: options.heightMode || 'full',
      levelId,
      topLevelId,
      bottomOffset: options.bottomOffset,
      topOffset: options.topOffset,
    });
    return {
      heightMode: offsets.heightMode,
      bottomOffset: offsets.bottomOffset,
      topOffset: offsets.topOffset,
      includeWind: hasOwn(options, 'includeWind') ? !!options.includeWind : true,
      includeSeismicWeight: hasOwn(options, 'includeSeismicWeight') ? !!options.includeSeismicWeight : false,
      unitWeight: sanitizeNonNegativeNumber(options.unitWeight, 0),
    };
  }

  _normalizeSurfaceRoof(type, options = {}) {
    if (!isSlopedSurfaceType(type)) {
      return {};
    }
    const roofFields = {
      roofSlope: sanitizeNonNegativeNumber(options.roofSlope, this.surfaceDraftRoofSlope || DEFAULT_ROOF_SLOPE_RATIO),
      roofDirection: normalizeRoofDirection(options.roofDirection || this.surfaceDraftRoofDirection),
      roofBaseOffset: sanitizeNumber(options.roofBaseOffset, this.surfaceDraftRoofBaseOffset || 0),
    };
    if (isRoofSurfaceType(type)) {
      roofFields.roofGroupId = sanitizeRoofGroupId(options.roofGroupId, this.surfaceDraftRoofGroupId || DEFAULT_ROOF_GROUP_ID);
    }
    return roofFields;
  }

  _normalizeSurfaceGable(type, levelId, topLevelId, options = {}) {
    if (!isGableWallSurfaceType(type)) return {};
    const bottomOffset = sanitizeNumber(options.bottomOffset, 0);
    const storyHeight = this.getStoryHeight(levelId, topLevelId);
    const fallbackTop = Math.max(bottomOffset + 1, sanitizeNumber(options.topOffset, storyHeight || DEFAULT_STORY_HEIGHT_MM));
    const startTop = sanitizeNumber(options.gableStartTopOffset, fallbackTop);
    const endTop = sanitizeNumber(options.gableEndTopOffset, fallbackTop);
    const gableStartTopOffset = startTop >= bottomOffset ? startTop : fallbackTop;
    const gableEndTopOffset = endTop >= bottomOffset ? endTop : fallbackTop;
    return {
      heightMode: 'custom',
      bottomOffset,
      topOffset: Math.max(gableStartTopOffset, gableEndTopOffset),
      gableStartTopOffset,
      gableEndTopOffset,
    };
  }

  // --- Nodes ---

  nextNodeId() {
    this._nodeCounter++;
    return this._nodeCounter;
  }

  addNode(x, y, z = 0) {
    const id = this.nextNodeId();
    const node = { id, x, y, z };
    this.nodes.push(node);
    this._touch();
    return node;
  }

  getNode(id) {
    return this._getById('nodes', id);
  }

  updateNode(id, props) {
    const node = this.getNode(id);
    if (node) {
      Object.assign(node, props);
      this._touch();
    }
    return node;
  }

  removeNode(id) {
    const before = this.nodes.length;
    this.nodes = this.nodes.filter(n => n.id !== id);
    if (this.nodes.length !== before) this._touch();
  }

  findNodeAt(x, y, tolerance = HIT_TOLERANCE_MM) {
    let closest = null;
    let minDist = tolerance;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < minDist) {
        minDist = d;
        closest = n;
      }
    }
    return closest;
  }

  // --- Members ---

  nextMemberId() {
    this._memberCounter++;
    return `M${this._memberCounter}`;
  }

  addMember(startNodeId, endNodeId, options = {}) {
    const id = this.nextMemberId();
    const type = options.type || 'beam';
    let sectionName = sanitizeText(options.sectionName) || '';
    const hasEndI = hasOwn(options, 'endI');
    const hasEndJ = hasOwn(options, 'endJ');

    if (!sectionName && (
      (options.b !== undefined && options.b !== null) ||
      (options.h !== undefined && options.h !== null) ||
      options.material
    )) {
      const material = sanitizeText(options.material) || 'steel';
      const b = sanitizePositiveNumber(options.b, DEFAULT_SECTION_B_MM);
      const h = sanitizePositiveNumber(options.h, DEFAULT_SECTION_H_MM);
      const section = this._findMemberSectionBySpec(type, material, b, h, options.color) ||
        this._createImportedMemberSection(type, material, b, h, options.color);
      sectionName = section.name;
    }

    const member = {
      id,
      type,
      startNodeId,
      endNodeId,
      sectionName,
      section: { b: DEFAULT_SECTION_B_MM, h: DEFAULT_SECTION_H_MM },
      levelId: options.levelId || this.activeLevelId || 'L0',
      material: 'steel',
      color: options.color || '#666666',
      topLevelId: options.topLevelId || null,
      geometryMode: normalizeMemberGeometryMode(options.geometryMode),
      startZ: sanitizeOptionalNumber(options.startZ),
      endZ: sanitizeOptionalNumber(options.endZ),
      roofRole: sanitizeText(options.roofRole) || null,
      bracePattern: options.bracePattern || 'single',
      endI: { condition: 'pin', springSymbol: null },
      endJ: { condition: 'pin', springSymbol: null },
    };
    this._ensureMemberSection(member, sectionName);
    const endDefaults = this._getMemberSectionEndDefaults(member);
    member.endI = this._normalizeMemberEnd(hasEndI ? options.endI : endDefaults.endI);
    member.endJ = this._normalizeMemberEnd(hasEndJ ? options.endJ : endDefaults.endJ);
    this.members.push(member);
    this._touch();
    return member;
  }

  getMember(id) {
    return this._getById('members', id);
  }

  updateMember(id, props) {
    const member = this.getMember(id);
    if (!member) return null;

    const patch = { ...props };
    const hasType = hasOwn(patch, 'type');
    const hasSectionName = hasOwn(patch, 'sectionName');
    const hasSection = hasOwn(patch, 'section');
    const hasMaterial = hasOwn(patch, 'material');
    const hasColor = hasOwn(patch, 'color');
    const hasEndI = hasOwn(patch, 'endI');
    const hasEndJ = hasOwn(patch, 'endJ');

    if (hasSection) {
      Object.assign(member.section, patch.section || {});
      delete patch.section;
    }
    if (hasEndI) {
      member.endI = this._normalizeMemberEnd(patch.endI);
      delete patch.endI;
    }
    if (hasEndJ) {
      member.endJ = this._normalizeMemberEnd(patch.endJ);
      delete patch.endJ;
    }
    if (hasColor) {
      // Color is section-driven, so direct color patching is ignored.
      delete patch.color;
    }
    sanitizePatchFields(patch, MEMBER_PATCH_SANITIZERS, member);

    Object.assign(member, patch);

    if (!hasEndI) member.endI = this._normalizeMemberEnd(member.endI);
    if (!hasEndJ) member.endJ = this._normalizeMemberEnd(member.endJ);

    if (!hasSectionName && (hasSection || hasMaterial)) {
      const material = sanitizeText(member.material) || 'steel';
      const b = sanitizePositiveNumber(member.section?.b, DEFAULT_SECTION_B_MM);
      const h = sanitizePositiveNumber(member.section?.h, DEFAULT_SECTION_H_MM);
      const section = this._findMemberSectionBySpec(member.type, material, b, h, member.color) ||
        this._createImportedMemberSection(member.type, material, b, h, member.color);
      member.sectionName = section.name;
    }

    if (hasType || hasSectionName || hasSection || hasMaterial || hasColor) {
      this._ensureMemberSection(member, member.sectionName);
    }
    this._touch();
    return member;
  }

  removeMember(id) {
    const member = this.getMember(id);
    if (!member) return;

    // Remove orphaned nodes
    const startId = member.startNodeId;
    const endId = member.endNodeId;
    this.members = this.members.filter(m => m.id !== id);

    for (const nid of [startId, endId]) {
      const used = this.members.some(m => m.startNodeId === nid || m.endNodeId === nid);
      if (!used) this.removeNode(nid);
    }

    if (this.selectedMemberId === id) {
      this.selectedMemberId = null;
    }
    this.selectedMemberIds = this.selectedMemberIds.filter(mid => mid !== id);
    // A multi-selection reduced to one member becomes a normal single
    // selection so the property panel and Delete stay consistent.
    if (this.selectedMemberIds.length === 1) {
      this.selectedMemberId = this.selectedMemberIds[0];
    }
    this._touch();
  }

  findMemberAt(x, y, tolerance = HIT_TOLERANCE_MM, predicate = null) {
    let closest = null;
    let minDist = tolerance;
    for (const m of this.members) {
      if (predicate && !predicate(m)) continue;
      const n1 = this.getNode(m.startNodeId);
      const n2 = this.getNode(m.endNodeId);
      if (!n1 || !n2) continue;
      const d = pointToSegmentDist(x, y, n1.x, n1.y, n2.x, n2.y);
      if (d < minDist) {
        minDist = d;
        closest = m;
      }
    }
    return closest;
  }

  _memberEndpointZ(member, key) {
    const value = Number(member[key]);
    if (Number.isFinite(value)) return value;
    const level = this.levels.find(l => l.id === member.levelId);
    return sanitizeNumber(level?.z, 0);
  }

  // --- Roof auto-generation (implementation lives in roof-generation.js) ---

  addRoofEdgeMembers(surfaceId, options = {}) {
    return roofGen.addRoofEdgeMembers(this, surfaceId, options);
  }

  addRoofSlopeMembers(surfaceId, options = {}) {
    return roofGen.addRoofSlopeMembers(this, surfaceId, options);
  }

  addRoofJointMembers(roofGroupId, options = {}) {
    return roofGen.addRoofJointMembers(this, roofGroupId, options);
  }

  addGableWallsFromRoofGroup(roofGroupId, options = {}) {
    return roofGen.addGableWallsFromRoofGroup(this, roofGroupId, options);
  }

  addEavesFromRoofGroup(roofGroupId, options = {}) {
    return roofGen.addEavesFromRoofGroup(this, roofGroupId, options);
  }

  addRoofPlanesFromSurface(sourceSurfaceId, options = {}) {
    return roofGen.addRoofPlanesFromSurface(this, sourceSurfaceId, options);
  }

  validateRoofGroup(roofGroupId, options = {}) {
    return roofGen.validateRoofGroup(this, roofGroupId, options);
  }

  removeRoofGeneratedElements(roofGroupId, options = {}) {
    return roofGen.removeRoofGeneratedElements(this, roofGroupId, options);
  }

  regenerateRoofGeneratedElements(roofGroupId, options = {}) {
    return roofGen.regenerateRoofGeneratedElements(this, roofGroupId, options);
  }

  listRoofGroups() {
    return roofGen.listRoofGroups(this);
  }

  getRoofGroupSurfaces(groupId) {
    return roofGen.getRoofGroupSurfaces(this, groupId);
  }

  // --- Surfaces ---

  nextSurfaceId() {
    this._surfaceCounter++;
    return `S${this._surfaceCounter}`;
  }

  // Shared surface factory: assigns the id and applies section / height /
  // roof / gable normalization before registering the surface.
  _createSurface(base, options) {
    const { type, levelId, topLevelId } = base;
    const surface = {
      id: this.nextSurfaceId(),
      sectionName: sanitizeText(options.sectionName) || '',
      ...base,
      ...this._normalizeSurfaceHeightAndWeight(type, levelId, topLevelId, options),
      ...this._normalizeSurfaceRoof(type, options),
    };
    Object.assign(surface, this._normalizeSurfaceGable(type, levelId, topLevelId, { ...surface, ...options }));
    this._ensureSurfaceSection(surface, surface.sectionName);
    this.surfaces.push(surface);
    this._touch();
    return surface;
  }

  addSurfaceRect(x1, y1, x2, y2, options = {}) {
    const type = options.type || 'floor';
    const levelId = options.levelId || this.activeLevelId || 'L0';
    // NOTE: rect/polygon surfaces prefer the draft top layer over the next
    // level, while line surfaces prefer the next level first (see
    // addSurfaceLine). The asymmetry is historical and intentionally kept.
    const topLevelId = options.topLevelId || this.surfaceDraftTopLevelId || this.getNextLevelId(levelId) || levelId;
    return this._createSurface({
      type,
      levelId,
      topLevelId,
      loadDirection: options.loadDirection || 'twoWay', // x | y | twoWay
      color: options.color || defaultSurfaceDrawColor(options.type),
      x1: Math.min(x1, x2),
      y1: Math.min(y1, y2),
      x2: Math.max(x1, x2),
      y2: Math.max(y1, y2),
      points: null,
      shape: 'rect',
    }, options);
  }

  addSurfaceLine(x1, y1, x2, y2, options = {}) {
    const type = options.type || 'wall';
    const levelId = options.levelId || this.activeLevelId || 'L0';
    // NOTE: topLevelId fallback order differs from addSurfaceRect/Polygon:
    // line surfaces prefer the next level before the draft top layer.
    const topLevelId = options.topLevelId || this.getNextLevelId(levelId) || this.surfaceDraftTopLevelId || levelId;
    return this._createSurface({
      type,
      levelId,
      topLevelId,
      loadDirection: 'twoWay',
      color: options.color || '#b57a6b',
      x1, y1, x2, y2,
      points: [{ x: x1, y: y1 }, { x: x2, y: y2 }],
      shape: 'line',
    }, options);
  }

  addSurfacePolygon(points, options = {}) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const type = options.type || 'wall';
    const levelId = options.levelId || this.activeLevelId || 'L0';
    // NOTE: same fallback order as addSurfaceRect (differs from addSurfaceLine).
    const topLevelId = options.topLevelId || this.surfaceDraftTopLevelId || this.getNextLevelId(levelId) || levelId;
    return this._createSurface({
      type,
      levelId,
      topLevelId,
      loadDirection: options.loadDirection || 'twoWay',
      color: options.color || defaultSurfaceDrawColor(options.type),
      x1: Math.min(...xs),
      y1: Math.min(...ys),
      x2: Math.max(...xs),
      y2: Math.max(...ys),
      points: points.map(p => ({ x: p.x, y: p.y })),
      shape: 'polygon',
    }, options);
  }

  getSurface(id) {
    return this._getById('surfaces', id);
  }

  updateSurface(id, props) {
    const surface = this.getSurface(id);
    if (!surface) return null;
    const patch = { ...props };
    const hasType = hasOwn(patch, 'type');
    const hasSectionName = hasOwn(patch, 'sectionName');
    const hasColor = hasOwn(patch, 'color');
    const hasHeightMode = hasOwn(patch, 'heightMode');
    const hasBottomOffset = hasOwn(patch, 'bottomOffset');
    const hasTopOffset = hasOwn(patch, 'topOffset');
    const hasGableStartTopOffset = hasOwn(patch, 'gableStartTopOffset');
    const hasGableEndTopOffset = hasOwn(patch, 'gableEndTopOffset');
    if (hasColor) {
      // Color is section-driven, so direct color patching is ignored.
      delete patch.color;
    }
    sanitizePatchFields(patch, SURFACE_PATCH_SANITIZERS, surface);

    const prospectiveType = patch.type || surface.type;
    stripSurfaceFieldsForType(patch, prospectiveType);
    if (isWallSurfaceType(prospectiveType) && (hasBottomOffset || hasTopOffset)) {
      const prospectiveBottom = hasBottomOffset ? patch.bottomOffset : surface.bottomOffset;
      const prospectiveTop = hasTopOffset ? patch.topOffset : surface.topOffset;
      if (prospectiveTop <= prospectiveBottom) {
        if (hasBottomOffset) delete patch.bottomOffset;
        if (hasTopOffset) delete patch.topOffset;
      }
    }
    if (isGableWallSurfaceType(prospectiveType)) {
      const prospectiveBottom = hasBottomOffset ? patch.bottomOffset : surface.bottomOffset;
      if (hasTopOffset && !hasGableStartTopOffset && !hasGableEndTopOffset) {
        patch.gableStartTopOffset = patch.topOffset;
        patch.gableEndTopOffset = patch.topOffset;
      }
      const prospectiveStart = hasOwn(patch, 'gableStartTopOffset') ? patch.gableStartTopOffset : surface.gableStartTopOffset;
      const prospectiveEnd = hasOwn(patch, 'gableEndTopOffset') ? patch.gableEndTopOffset : surface.gableEndTopOffset;
      if (prospectiveStart < prospectiveBottom) delete patch.gableStartTopOffset;
      if (prospectiveEnd < prospectiveBottom) delete patch.gableEndTopOffset;
    }

    Object.assign(surface, patch);
    if (isGableWallSurfaceType(surface.type) && (
      hasType || hasHeightMode || hasBottomOffset || hasTopOffset || hasGableStartTopOffset || hasGableEndTopOffset
    )) {
      Object.assign(surface, this._normalizeSurfaceGable(surface.type, surface.levelId, surface.topLevelId, surface));
    }
    if (hasHeightMode && surface.heightMode !== 'custom' && isWallSurfaceType(surface.type) && !isGableWallSurfaceType(surface.type)) {
      Object.assign(surface, this._normalizeSurfaceHeightAndWeight(surface.type, surface.levelId, surface.topLevelId, surface));
    }
    if (hasType) {
      if (isSlopedSurfaceType(surface.type)) {
        Object.assign(surface, this._normalizeSurfaceRoof(surface.type, surface));
      }
      stripSurfaceFieldsForType(surface, surface.type);
    }
    if (hasType || hasSectionName || hasColor || hasOwn(props, 'unitWeight')) {
      this._ensureSurfaceSection(surface, surface.sectionName);
    }
    this._touch();
    return surface;
  }

  removeSurface(id) {
    const before = this.surfaces.length;
    this.surfaces = this.surfaces.filter(s => s.id !== id);
    if (this.selectedSurfaceId === id) {
      this.selectedSurfaceId = null;
    }
    if (this.surfaces.length !== before) this._touch();
  }

  findSurfaceAt(x, y, predicate = null) {
    const wallOffset = this.settings.wallDisplayOffset || WALL_DISPLAY_OFFSET_MM;
    for (let i = this.surfaces.length - 1; i >= 0; i--) {
      const s = this.surfaces[i];
      if (predicate && !predicate(s)) continue;
      const isWallType = isWallSurfaceType(s.type);
      if (s.shape === 'line') {
        const lx1 = s.x1 + wallOffset;
        const ly1 = s.y1 + wallOffset;
        const lx2 = s.x2 + wallOffset;
        const ly2 = s.y2 + wallOffset;
        if (pointToSegmentDist(x, y, lx1, ly1, lx2, ly2) < HIT_TOLERANCE_MM) {
          return s;
        }
        continue;
      }
      if (s.shape === 'polygon' && Array.isArray(s.points)) {
        if (s.type === 'exteriorWall') {
          // Hit test against outward-offset edges
          if (hitExteriorWallEdges(x, y, s.points, wallOffset, HIT_TOLERANCE_MM)) return s;
          continue;
        }
        const pts = s.points.map(p => ({
          x: p.x + (isWallType ? wallOffset : 0),
          y: p.y + (isWallType ? wallOffset : 0),
        }));
        if (pointInPolygon({ x, y }, pts)) {
          return s;
        }
        continue;
      }
      const x1 = isWallType ? s.x1 + wallOffset : s.x1;
      const y1 = isWallType ? s.y1 + wallOffset : s.y1;
      const x2 = isWallType ? s.x2 + wallOffset : s.x2;
      const y2 = isWallType ? s.y2 + wallOffset : s.y2;
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2) {
        return s;
      }
    }
    return null;
  }

  // --- Levels ---

  nextLevelId() {
    this._levelCounter++;
    return `L${this._levelCounter}`;
  }

  addLevel(name, z) {
    const id = this.nextLevelId();
    const level = { id, name, z };
    this.levels.push(level);
    this._touch();
    return level;
  }

  updateLevel(id, props) {
    const level = this.levels.find(l => l.id === id);
    if (level) {
      Object.assign(level, props);
      this._touch();
    }
    return level;
  }

  getLevelUsage(id) {
    const members = this.members.filter(m => m.levelId === id || m.topLevelId === id);
    const surfaces = this.surfaces.filter(s => s.levelId === id || s.topLevelId === id);
    const loads = this.loads.filter(l => l.levelId === id);
    const supports = this.supports.filter(s => s.levelId === id);
    return { members, surfaces, loads, supports };
  }

  removeLevel(id) {
    if (this.levels.length <= 1) return false;
    const { members, surfaces, loads, supports } = this.getLevelUsage(id);
    if (members.length > 0 || surfaces.length > 0 || loads.length > 0 || supports.length > 0) {
      return false;
    }
    this.levels = this.levels.filter(l => l.id !== id);
    if (this.activeLevelId === id) {
      this.activeLevelId = this.levels[0].id;
    }
    if (this.surfaceDraftTopLevelId === id) {
      // Pick the replacement by elevation, not by array order: a level below GL
      // (the generated foundation) is appended last, so the tail of the array is
      // not necessarily the topmost level.
      this.surfaceDraftTopLevelId = this.getNextLevelId(this.activeLevelId)
        || [...this.levels].sort((a, b) => a.z - b.z).pop().id;
    }
    this._touch();
    return true;
  }

  copyLevelElements(sourceLevelId, targetLevelId, options = {}) {
    return modelOps.copyLevelElements(this, sourceLevelId, targetLevelId, options);
  }

  validateModel() {
    return modelOps.validateModel(this);
  }

  mergeNearbyNodes(options = {}) {
    return modelOps.mergeNearbyNodes(this, options);
  }

  canJoinMembers(ids) {
    return modelOps.canJoinMembers(this, ids);
  }

  joinMembers(ids, options = {}) {
    return modelOps.joinMembers(this, ids, options);
  }

  splitMemberAtPoint(id, options = {}) {
    return modelOps.splitMemberAtPoint(this, id, options);
  }

  splitColumnAtLevel(id, options = {}) {
    return modelOps.splitColumnAtLevel(this, id, options);
  }

  splitIntersectingMembers(options = {}) {
    return modelOps.splitIntersectingMembers(this, options);
  }

  mirrorMembers(ids, options = {}) {
    return modelOps.mirrorMembers(this, ids, options);
  }

  rotateMembers(ids, options = {}) {
    return modelOps.rotateMembers(this, ids, options);
  }

  arrayCopyMembers(ids, options = {}) {
    return modelOps.arrayCopyMembers(this, ids, options);
  }

  // --- Axes (通り芯) ---

  nextAxisId() {
    this._axisCounter++;
    return `AX${this._axisCounter}`;
  }

  addAxis(dir, name, coord) {
    const normalizedDir = dir === 'y' ? 'y' : 'x';
    const axis = {
      id: this.nextAxisId(),
      dir: normalizedDir,
      name: sanitizeText(name) || this._nextAxisName(normalizedDir),
      coord: sanitizeNumber(coord, 0),
    };
    this.axes.push(axis);
    this._touch();
    return axis;
  }

  _nextAxisName(dir) {
    const prefix = dir === 'y' ? 'Y' : 'X';
    let n = 1;
    while (this.axes.some(a => a.name === `${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  getAxis(id) {
    return this.axes.find(a => a.id === id);
  }

  updateAxis(id, props) {
    const axis = this.getAxis(id);
    if (!axis) return null;
    if (hasOwn(props, 'dir')) axis.dir = props.dir === 'y' ? 'y' : 'x';
    if (hasOwn(props, 'name')) axis.name = sanitizeText(props.name) || axis.name;
    if (hasOwn(props, 'coord')) axis.coord = sanitizeNumber(props.coord, axis.coord);
    this._touch();
    return axis;
  }

  removeAxis(id) {
    const before = this.axes.length;
    this.axes = this.axes.filter(a => a.id !== id);
    if (this.axes.length !== before) this._touch();
    return this.axes.length !== before;
  }

  // --- Load combinations ---

  addLoadCombination(name, factors = {}) {
    this._loadComboCounter++;
    const combo = {
      id: `LC${this._loadComboCounter}`,
      name: sanitizeText(name) || `LC${this._loadComboCounter}`,
      factors: normalizeLoadFactors(factors),
    };
    this.loadCombinations.push(combo);
    this._touch();
    return combo;
  }

  updateLoadCombination(id, props) {
    const combo = this.loadCombinations.find(c => c.id === id);
    if (!combo) return null;
    if (hasOwn(props, 'name')) combo.name = sanitizeText(props.name) || combo.name;
    if (hasOwn(props, 'factors')) combo.factors = normalizeLoadFactors(props.factors);
    this._touch();
    return combo;
  }

  removeLoadCombination(id) {
    const before = this.loadCombinations.length;
    this.loadCombinations = this.loadCombinations.filter(c => c.id !== id);
    if (this.loadCombinations.length !== before) this._touch();
    return this.loadCombinations.length !== before;
  }

  // --- Drawing underlay ---

  setUnderlay(underlay) {
    if (!underlay || !Array.isArray(underlay.entities) || !underlay.entities.length) {
      return null;
    }
    this.underlay = {
      name: sanitizeText(underlay.name) || 'underlay',
      entities: underlay.entities,
    };
    this._touch();
    return this.underlay;
  }

  clearUnderlay() {
    if (!this.underlay) return false;
    this.underlay = null;
    this._touch();
    return true;
  }

  // --- Loads ---

  nextLoadId() {
    this._loadCounter++;
    return `LD${this._loadCounter}`;
  }

  addLoad(type, props = {}) {
    const id = this.nextLoadId();
    const base = {
      id,
      type,
      levelId: props.levelId || this.activeLevelId || 'L0',
      loadCase: normalizeLoadCase(props.loadCase || this.loadDraftCase),
    };
    if (type === 'areaLoad') {
      Object.assign(base, {
        x1: Math.min(props.x1, props.x2), y1: Math.min(props.y1, props.y2),
        x2: Math.max(props.x1, props.x2), y2: Math.max(props.y1, props.y2),
        value: props.value || 0,
        color: props.color || '#e57373',
      });
    } else if (type === 'lineLoad') {
      Object.assign(base, {
        x1: props.x1, y1: props.y1, x2: props.x2, y2: props.y2,
        value: props.value || 0,
        color: props.color || '#ffb74d',
      });
    } else if (type === 'pointLoad') {
      Object.assign(base, {
        x1: props.x1, y1: props.y1,
        fx: props.fx || 0, fy: props.fy || 0, fz: props.fz || 0,
        mx: props.mx || 0, my: props.my || 0, mz: props.mz || 0,
        color: props.color || '#ba68c8',
      });
    }
    this.loads.push(base);
    this._touch();
    return base;
  }

  getLoad(id) {
    return this._getById('loads', id);
  }

  updateLoad(id, props) {
    const load = this.getLoad(id);
    if (load) {
      const patch = { ...props };
      if (hasOwn(patch, 'loadCase')) patch.loadCase = normalizeLoadCase(patch.loadCase);
      Object.assign(load, patch);
      this._touch();
    }
    return load;
  }

  removeLoad(id) {
    const before = this.loads.length;
    this.loads = this.loads.filter(l => l.id !== id);
    if (this.selectedLoadId === id) {
      this.selectedLoadId = null;
    }
    if (this.loads.length !== before) this._touch();
  }

  findLoadAt(x, y, predicate = null) {
    for (let i = this.loads.length - 1; i >= 0; i--) {
      const ld = this.loads[i];
      if (predicate && !predicate(ld)) continue;
      if (ld.type === 'areaLoad') {
        if (x >= ld.x1 && x <= ld.x2 && y >= ld.y1 && y <= ld.y2) return ld;
      } else if (ld.type === 'lineLoad') {
        if (pointToSegmentDist(x, y, ld.x1, ld.y1, ld.x2, ld.y2) < HIT_TOLERANCE_MM) return ld;
      } else if (ld.type === 'pointLoad') {
        if (Math.hypot(x - ld.x1, y - ld.y1) < HIT_TOLERANCE_MM) return ld;
      }
    }
    return null;
  }

  // --- Supports ---

  nextSupportId() {
    this._supportCounter++;
    return `SUP${this._supportCounter}`;
  }

  addSupport(x, y, options = {}) {
    const id = this.nextSupportId();
    const support = {
      id,
      x,
      y,
      levelId: options.levelId || this.activeLevelId || 'L0',
      dx: options.dx !== undefined ? !!options.dx : true,
      dy: options.dy !== undefined ? !!options.dy : true,
      dz: options.dz !== undefined ? !!options.dz : true,
      rx: options.rx !== undefined ? !!options.rx : false,
      ry: options.ry !== undefined ? !!options.ry : false,
      rz: options.rz !== undefined ? !!options.rz : false,
    };
    this.supports.push(support);
    this._touch();
    return support;
  }

  getSupport(id) {
    return this._getById('supports', id);
  }

  updateSupport(id, props) {
    const support = this.getSupport(id);
    if (support) {
      Object.assign(support, props);
      this._touch();
    }
    return support;
  }

  removeSupport(id) {
    const before = this.supports.length;
    this.supports = this.supports.filter(s => s.id !== id);
    if (this.selectedSupportId === id) {
      this.selectedSupportId = null;
    }
    if (this.supports.length !== before) this._touch();
  }

  findSupportAt(x, y, tolerance = HIT_TOLERANCE_MM, predicate = null) {
    let closest = null;
    let minDist = tolerance;
    for (const s of this.supports) {
      if (predicate && !predicate(s)) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < minDist) {
        minDist = d;
        closest = s;
      }
    }
    return closest;
  }

  // --- Serialization (implementation lives in serialization.js) ---

  toJSON() {
    return serializeModel(this);
  }

  loadJSON(data) {
    loadModelJSON(this, data);
  }

  // Deep clone for undo/redo snapshots
  snapshot() {
    return structuredClone(this.toJSON());
  }

  restoreSnapshot(snap) {
    this.loadJSON(snap);
  }
}

// --- Utility ---

// Normalizes a loaded/imported axis record; returns null when unusable.

// Applies the per-field sanitizer table to a patch object in place.

// Removes surface fields that do not apply to the given type. Shared by
// updateSurface (patch + record) and _normalizeLoadedSurface.

// Initial draw color for a surface before the section color is applied.

function hitExteriorWallEdges(px, py, points, offset, tolerance) {
  const oPts = offsetPolygonOutward(points, offset);
  for (let i = 0; i < oPts.length; i++) {
    const a = oPts[i], b = oPts[(i + 1) % oPts.length];
    if (pointToSegmentDist(px, py, a.x, a.y, b.x, b.y) < tolerance) return true;
  }
  return false;
}
