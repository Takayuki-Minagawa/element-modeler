// constants.js - shared model / display constants (units in mm unless noted)

// Kept in sync with package.json by scripts/version-sync.mjs.
export const APP_VERSION = '1.6.3';

// Unit conversion
export const MM_TO_M = 0.001;
export const MM2_TO_M2 = 1e-6;

// Model defaults
export const DEFAULT_SECTION_B_MM = 200;
export const DEFAULT_SECTION_H_MM = 400;
export const DEFAULT_STORY_HEIGHT_MM = 2800;
export const DEFAULT_RAFTER_SPACING_MM = 910;
export const DEFAULT_EAVE_DEPTH_MM = 600;
export const DEFAULT_ROOF_GROUP_ID = 'RG1';
// Default roof slope as rise/run ratio (0.3 = 3寸勾配相当, unitless)
export const DEFAULT_ROOF_SLOPE_RATIO = 0.3;
// Waist wall (腰壁): default top offset above the bottom level
export const WAIST_WALL_TOP_OFFSET_MM = 1200;
// Hanging wall (垂れ壁): default depth measured down from the story top
export const HANGING_WALL_DEPTH_MM = 600;

// Display
export const WALL_DISPLAY_OFFSET_MM = 120;
// Max number of model-check issues shown before collapsing into a "+N more" note
export const MODEL_CHECK_DISPLAY_LIMIT = 12;
// Canvas scale-to-percent factor for the zoom status readout (scale * factor = %)
export const ZOOM_PERCENT_FACTOR = 2000;

// Load cases (fixed identifiers; labels resolved through i18n `loadCase<ID>`)
export const LOAD_CASES = ['DL', 'LL', 'EQX', 'EQY', 'WX', 'WY'];
export const DEFAULT_LOAD_CASE = 'DL';

// Node merge / member split defaults (mm)
export const NODE_MERGE_TOLERANCE_MM = 1;
export const MEMBER_JOIN_TOLERANCE_MM = 1;
export const MEMBER_SPLIT_TOLERANCE_MM = 1;

// Axis (通り芯) rendering
export const AXIS_SNAP_TOLERANCE_PX = 12;

// Hit testing
export const HIT_TOLERANCE_MM = 300;
export const PICK_TOLERANCE_PX = 8;
export const WIDE_PICK_TOLERANCE_PX = 20;
// Screen distance within which a polyline click closes the loop
export const POLYLINE_CLOSE_TOLERANCE_PX = 8;
