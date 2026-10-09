// display-settings.js - Settings defaults, display presets, and the
// normalizers for display-related settings values. Extracted from state.js.

import { WALL_DISPLAY_OFFSET_MM } from './constants.js';

const PLAN_LAYER_DISPLAY_MODES = new Set(['all', 'current', 'halftone']);
const MEMBER_3D_RENDER_MODES = new Set(['solid', 'line']);
const BEAM_3D_SECTION_MODES = new Set(['box', 'hStrong', 'hWeak']);
const DISPLAY_PRESETS = new Set(['input', 'review', 'presentation']);

export const GRID_SIZE_MIN = 100;
export const GRID_SIZE_MAX = 1000;
export const GRID_SIZE_DEFAULT = 1000;

// Local copy of the trivial text sanitizer to keep this module dependency-free.
function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function createDefaultSettings() {
  return {
    gridSize: GRID_SIZE_DEFAULT,
    snap: true,
    wallDisplayOffset: WALL_DISPLAY_OFFSET_MM,
    showSupports: true,
    widePick: false,
    planLayerDisplayMode: 'all',
    planLayerSelectionLock: false,
    view3dLayerDisplayMode: 'all',
    member3dRenderMode: 'solid',
    beam3dSectionMode: 'box',
    showMembers: true,
    showSurfaces: true,
    showLoads: true,
    showMemberEndSymbols: true,
    showPlacementLabels: true,
    memberTypeFilter: 'all',
    sectionFilter: 'all',
    displayPreset: 'input',
    showAxes: true,
    showUnderlay: true,
    autosave: true,
  };
}

// Merges raw (loaded) settings over the defaults and normalizes every
// mode/filter field. Used by loadJSON; the constructor uses the defaults,
// which are already normalized.
export function normalizeSettings(raw) {
  const settings = { ...createDefaultSettings(), ...raw };
  settings.planLayerDisplayMode = normalizePlanLayerDisplayMode(settings.planLayerDisplayMode);
  settings.view3dLayerDisplayMode = normalizePlanLayerDisplayMode(settings.view3dLayerDisplayMode);
  settings.member3dRenderMode = normalizeMember3DRenderMode(settings.member3dRenderMode);
  settings.beam3dSectionMode = normalizeBeam3DSectionMode(settings.beam3dSectionMode);
  settings.planLayerSelectionLock = !!settings.planLayerSelectionLock;
  settings.showMembers = settings.showMembers !== false;
  settings.showSurfaces = settings.showSurfaces !== false;
  settings.showLoads = settings.showLoads !== false;
  settings.showMemberEndSymbols = !!settings.showMemberEndSymbols;
  settings.showPlacementLabels = settings.showPlacementLabels !== false;
  settings.memberTypeFilter = normalizeMemberTypeFilter(settings.memberTypeFilter);
  settings.sectionFilter = sanitizeText(settings.sectionFilter) || 'all';
  settings.displayPreset = normalizeDisplayPreset(settings.displayPreset);
  settings.gridSize = normalizeGridSize(settings.gridSize);
  settings.showAxes = settings.showAxes !== false;
  settings.showUnderlay = settings.showUnderlay !== false;
  settings.autosave = settings.autosave !== false;
  return settings;
}

// Settings keys driven by display presets.
const DISPLAY_PRESET_KEYS = [
  'planLayerDisplayMode',
  'planLayerSelectionLock',
  'view3dLayerDisplayMode',
  'member3dRenderMode',
  'showMembers',
  'showSurfaces',
  'showLoads',
  'showMemberEndSymbols',
  'showPlacementLabels',
];

const DISPLAY_PRESET_OVERRIDES = {
  review: {
    planLayerDisplayMode: 'halftone',
    planLayerSelectionLock: true,
    view3dLayerDisplayMode: 'halftone',
    member3dRenderMode: 'line',
    showMembers: true,
    showSurfaces: true,
    showLoads: true,
    showMemberEndSymbols: true,
    showPlacementLabels: true,
  },
  presentation: {
    planLayerDisplayMode: 'current',
    planLayerSelectionLock: true,
    view3dLayerDisplayMode: 'current',
    member3dRenderMode: 'solid',
    showMembers: true,
    showSurfaces: true,
    showLoads: false,
    showMemberEndSymbols: false,
    showPlacementLabels: false,
  },
};

export function displayPresetSettings(preset) {
  if (DISPLAY_PRESET_OVERRIDES[preset]) return { ...DISPLAY_PRESET_OVERRIDES[preset] };
  // The 'input' preset mirrors the built-in defaults.
  const defaults = createDefaultSettings();
  return Object.fromEntries(DISPLAY_PRESET_KEYS.map(key => [key, defaults[key]]));
}

export function normalizePlanLayerDisplayMode(value) {
  const text = sanitizeText(value);
  return PLAN_LAYER_DISPLAY_MODES.has(text) ? text : 'all';
}

export function normalizeMember3DRenderMode(value) {
  const text = sanitizeText(value);
  return MEMBER_3D_RENDER_MODES.has(text) ? text : 'solid';
}

export function normalizeBeam3DSectionMode(value) {
  const text = sanitizeText(value);
  return BEAM_3D_SECTION_MODES.has(text) ? text : 'box';
}

export function normalizeMemberTypeFilter(value) {
  const text = sanitizeText(value);
  return ['all', 'beam', 'column', 'hbrace', 'vbrace'].includes(text) ? text : 'all';
}

export function normalizeDisplayPreset(value) {
  const text = sanitizeText(value);
  return DISPLAY_PRESETS.has(text) ? text : 'input';
}

export function normalizeGridSize(value) {
  const num = Math.round(Number(value));
  if (!Number.isFinite(num)) return GRID_SIZE_DEFAULT;
  return Math.min(GRID_SIZE_MAX, Math.max(GRID_SIZE_MIN, num));
}
