// section-catalog.js - Built-in section/spring catalog definitions and the
// pure normalization helpers around them. Extracted from state.js; nothing in
// this module depends on AppState.

import { DEFAULT_SECTION_B_MM, DEFAULT_SECTION_H_MM } from './constants.js';
import { positiveNumber as sanitizePositiveNumber } from './geometry-utils.js';

export const DEFAULT_SECTION_DEFINITIONS = [
  { target: 'member', type: 'beam', name: '_G', material: 'steel', b: DEFAULT_SECTION_B_MM, h: DEFAULT_SECTION_H_MM, color: '#666666', defaultEndI: { condition: 'pin', springSymbol: null }, defaultEndJ: { condition: 'pin', springSymbol: null }, isDefault: true },
  { target: 'member', type: 'column', name: '_C', material: 'steel', b: 105, h: 105, color: '#666666', defaultEndI: { condition: 'pin', springSymbol: null }, defaultEndJ: { condition: 'pin', springSymbol: null }, isDefault: true },
  { target: 'member', type: 'hbrace', name: '_H', material: 'steel', b: 20, h: 20, color: '#666666', defaultEndI: { condition: 'pin', springSymbol: null }, defaultEndJ: { condition: 'pin', springSymbol: null }, isDefault: true },
  { target: 'member', type: 'vbrace', name: '_V', material: 'steel', b: 20, h: 20, color: '#666666', defaultEndI: { condition: 'pin', springSymbol: null }, defaultEndJ: { condition: 'pin', springSymbol: null }, isDefault: true },
  { target: 'surface', type: 'floor', name: '_S', material: '', b: null, h: null, color: '#67a9cf', isDefault: true },
  { target: 'surface', type: 'exteriorWall', name: '_OW', material: '', b: null, h: null, color: '#b57a6b', isDefault: true },
  { target: 'surface', type: 'wall', name: '_IW', material: '', b: null, h: null, color: '#b57a6b', isDefault: true },
  { target: 'surface', type: 'roof', name: '_R', material: '', b: null, h: null, color: '#8b6f47', isDefault: true },
  { target: 'surface', type: 'eave', name: '_E', material: '', b: null, h: null, color: '#4f9a8a', isDefault: true },
  { target: 'surface', type: 'gableWall', name: '_GW', material: '', b: null, h: null, color: '#bf6f5e', isDefault: true },
];

export const DEFAULT_SPRING_DEFINITIONS = [
  { symbol: '_SP', kr: null, krY: null, krZ: null, kt: null, kv: null, memo: '回転バネ', isDefault: true },
];

// Trial defaults for analysis-model preparation. They are intentionally
// marked as defaults in both the UI and exported model; project-specific
// values should be reviewed and edited before design use.
export const DEFAULT_MATERIAL_DEFINITIONS = [
  { name: 'steel', E: 205000, G: 79000, density: 7850, isDefault: true },
  { name: 'rc', E: 24000, G: 10000, density: 2400, isDefault: true },
  { name: 'wood', E: 10000, G: 650, density: 500, isDefault: true },
];

export const DEFAULT_SECTION_NAME_SET = new Set(DEFAULT_SECTION_DEFINITIONS.map(s => s.name));
export const DEFAULT_SPRING_SYMBOL_SET = new Set(DEFAULT_SPRING_DEFINITIONS.map(s => s.symbol));
export const DEFAULT_MATERIAL_NAME_SET = new Set(DEFAULT_MATERIAL_DEFINITIONS.map(m => m.name));
export const END_FIXITIES = new Set(['pin', 'rigid', 'spring']);
export const SECTION_SHAPES = new Set(['rectangle', 'hSection', 'boxSection']);
export const SECTION_PROPERTY_SOURCES = new Set(['catalog', 'computed', 'manual']);
export const SURFACE_SELF_WEIGHT_MODES = new Set(['manual', 'fromDensity']);
export const PANEL_DIRECTIONS = new Set(['x', 'y']);
export const MEMBER_SECTION_TYPE_ALIAS = {
  brace: 'hbrace',
};

// Local copy of the trivial text sanitizer to keep this module dependency-free.
function sanitizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeSectionType(target, type) {
  if (!type) return '';
  if (target === 'member') {
    return MEMBER_SECTION_TYPE_ALIAS[type] || type;
  }
  return type;
}

export function normalizeSectionShape(value) {
  return SECTION_SHAPES.has(value) ? value : 'rectangle';
}

export function createDefaultSectionCatalog() {
  return DEFAULT_SECTION_DEFINITIONS.map(s => ({
    ...s,
    type: MEMBER_SECTION_TYPE_ALIAS[s.type] || s.type,
    ...(s.target === 'member' ? {
      shape: 'rectangle',
      flangeThickness: null,
      webThickness: null,
      boxThickness: null,
      shearAreaRatioY: null,
      shearAreaRatioZ: null,
      designation: null,
      propertySource: null,
      Avy: null,
      Avz: null,
    } : {
      thickness: null, selfWeightMode: null, additionalWeight: null,
      panelDirection: null, endRotationalSpring: null,
      edgeSprings: { panelToPanel: null, panelToBeam: null },
    }),
    defaultEndI: s.defaultEndI ? { ...s.defaultEndI } : undefined,
    defaultEndJ: s.defaultEndJ ? { ...s.defaultEndJ } : undefined,
  }));
}

export function createDefaultSpringCatalog() {
  return DEFAULT_SPRING_DEFINITIONS.map(s => ({ ...s }));
}

export function createDefaultMaterialCatalog() {
  return DEFAULT_MATERIAL_DEFINITIONS.map(material => ({ ...material }));
}

export function normalizeCatalogSectionEntry(entry) {
  if (!entry || (entry.target !== 'member' && entry.target !== 'surface')) return null;
  const type = entry.target === 'member'
    ? (MEMBER_SECTION_TYPE_ALIAS[entry.type] || entry.type)
    : entry.type;
  const name = sanitizeText(entry.name);
  if (!type || !name) return null;
  const material = sanitizeText(entry.material) || (entry.target === 'member' ? 'steel' : '');

  let memberShape = null;
  if (entry.target === 'member') {
    for (const dimension of ['b', 'h']) {
      if (!isValidOptionalPositiveNumber(entry[dimension])) {
        throw new Error(`Invalid section dimension ${dimension}: ${name}`);
      }
    }
    const rawProperties = {
      A: entry.A ?? entry.area,
      Iy: entry.Iy,
      Iz: entry.Iz,
      J: entry.J,
      Avy: entry.Avy,
      Avz: entry.Avz,
    };
    for (const [property, value] of Object.entries(rawProperties)) {
      if (!isValidOptionalPositiveNumber(value)) {
        throw new Error(`Invalid section property ${property}: ${name}`);
      }
    }
    for (const ratio of ['shearAreaRatioY', 'shearAreaRatioZ']) {
      if (!isValidOptionalRatio(entry[ratio])) {
        throw new Error(`Invalid shear area ratio ${ratio}: ${name}`);
      }
    }
    const b = sanitizePositiveNumber(entry.b, DEFAULT_SECTION_B_MM);
    const h = sanitizePositiveNumber(entry.h, DEFAULT_SECTION_H_MM);
    memberShape = normalizeMemberShape(entry, b, h, name);
    if (!isValidOptionalChoice(entry.propertySource, SECTION_PROPERTY_SOURCES)) {
      throw new Error(`Invalid section property source: ${name}`);
    }
  } else {
    if (!isValidOptionalPositiveNumber(entry.thickness)) {
      throw new Error(`Invalid surface thickness: ${name}`);
    }
    if (!isValidOptionalNonNegativeNumber(entry.additionalWeight)) {
      throw new Error(`Invalid surface additional weight: ${name}`);
    }
    if (!isValidOptionalChoice(entry.selfWeightMode, SURFACE_SELF_WEIGHT_MODES)) {
      throw new Error(`Invalid surface self weight mode: ${name}`);
    }
    if (!isValidOptionalChoice(entry.panelDirection, PANEL_DIRECTIONS)) {
      throw new Error(`Invalid panel direction: ${name}`);
    }
  }

  const normalized = {
    target: entry.target,
    type,
    name,
    material,
    b: entry.target === 'member' ? sanitizePositiveNumber(entry.b, DEFAULT_SECTION_B_MM) : null,
    h: entry.target === 'member' ? sanitizePositiveNumber(entry.h, DEFAULT_SECTION_H_MM) : null,
    color: sanitizeColor(entry.color, defaultColorForSection(entry.target, type)),
    memo: sanitizeText(entry.memo) || '',
  };
  if (entry.target === 'member') {
    normalized.A = optionalPositiveNumber(entry.A ?? entry.area);
    normalized.Iy = optionalPositiveNumber(entry.Iy);
    normalized.Iz = optionalPositiveNumber(entry.Iz);
    normalized.J = optionalPositiveNumber(entry.J);
    normalized.Avy = optionalPositiveNumber(entry.Avy);
    normalized.Avz = optionalPositiveNumber(entry.Avz);
    normalized.designation = sanitizeText(entry.designation) || null;
    normalized.propertySource = sanitizeText(entry.propertySource) || null;
    normalized.shape = memberShape.shape;
    normalized.flangeThickness = memberShape.flangeThickness;
    normalized.webThickness = memberShape.webThickness;
    normalized.boxThickness = memberShape.boxThickness;
    normalized.shearAreaRatioY = optionalRatio(entry.shearAreaRatioY);
    normalized.shearAreaRatioZ = optionalRatio(entry.shearAreaRatioZ);
    normalized.defaultEndI = normalizeSectionDefaultEnd(entry.defaultEndI || entry.endI);
    normalized.defaultEndJ = normalizeSectionDefaultEnd(entry.defaultEndJ || entry.endJ);
  } else {
    normalized.thickness = optionalPositiveNumber(entry.thickness);
    normalized.selfWeightMode = sanitizeText(entry.selfWeightMode) || null;
    normalized.additionalWeight = isBlank(entry.additionalWeight) ? null : Number(entry.additionalWeight);
    normalized.panelDirection = sanitizeText(entry.panelDirection) || null;
    normalized.endRotationalSpring = normalizeSpringReference(entry.endRotationalSpring, `endRotationalSpring: ${name}`);
    normalized.edgeSprings = normalizeEdgeSprings(entry.edgeSprings, name);
  }
  return normalized;
}

export function normalizeSpringEntry(entry) {
  if (!entry) return null;
  const symbol = sanitizeText(entry.symbol || entry.name);
  if (!symbol) return null;
  const stiffness = {};
  for (const field of ['kr', 'krY', 'krZ', 'kt', 'kv']) {
    if (!isValidOptionalSpringStiffness(entry[field])) {
      throw new Error(`Invalid spring stiffness ${field}: ${symbol}`);
    }
    stiffness[field] = normalizeSpringStiffness(entry[field]);
  }
  return {
    symbol,
    ...stiffness,
    memo: sanitizeText(entry.memo) || '',
  };
}

// These are catalog symbol references, never stiffness numbers or implicit
// fallbacks. Preserve unknown symbols so editing/loading cannot silently
// substitute a different connection; analysis preflight checks resolution.
function normalizeSpringReference(value, label) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new Error(`Invalid spring reference ${label}`);
  return value.trim() || null;
}

function normalizeEdgeSprings(value, name) {
  if (value !== null && value !== undefined &&
      (typeof value !== 'object' || Array.isArray(value) ||
       Object.keys(value).some(key => !['panelToPanel', 'panelToBeam'].includes(key)))) {
    throw new Error(`Invalid surface edge springs: ${name}`);
  }
  return {
    panelToPanel: normalizeSpringReference(value?.panelToPanel, `edgeSprings.panelToPanel: ${name}`),
    panelToBeam: normalizeSpringReference(value?.panelToBeam, `edgeSprings.panelToBeam: ${name}`),
  };
}

export function surfaceSpringSymbols(section) {
  return [section?.endRotationalSpring, section?.edgeSprings?.panelToPanel, section?.edgeSprings?.panelToBeam]
    .filter(symbol => typeof symbol === 'string' && symbol.length > 0);
}

export function normalizeMaterialEntry(entry) {
  if (!entry) return null;
  const name = sanitizeText(entry.name || entry.material);
  if (!name) return null;
  const E = optionalPositiveNumber(entry.E);
  const G = optionalPositiveNumber(entry.G);
  const density = optionalPositiveNumber(entry.density ?? entry.rho);
  if (E === null || G === null || density === null) return null;
  return { name, E, G, density };
}

export function isValidOptionalPositiveNumber(value) {
  if (isBlank(value)) return true;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}

function isBlank(value) {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function isValidOptionalChoice(value, choices) {
  return isBlank(value) || (typeof value === 'string' && choices.has(value.trim()));
}

export function isValidOptionalNonNegativeNumber(value) {
  if (isBlank(value)) return true;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0;
}

export function isValidOptionalSpringStiffness(value) {
  return value === 'pin' || value === 'rigid' || isValidOptionalPositiveNumber(value);
}

export function normalizeSpringStiffness(value) {
  if (!isValidOptionalSpringStiffness(value)) throw new Error('Invalid spring stiffness');
  return value === 'pin' || value === 'rigid' ? value : optionalPositiveNumber(value);
}

// Missing directional values inherit the common bending stiffness. A null
// common value remains unspecified; consumers decide how to handle it.
export function resolveSpringStiffness(spring) {
  const kr = normalizeSpringStiffness(spring?.kr);
  return {
    krY: normalizeSpringStiffness(spring?.krY) ?? kr,
    krZ: normalizeSpringStiffness(spring?.krZ) ?? kr,
    kt: normalizeSpringStiffness(spring?.kt),
  };
}

export function isValidOptionalRatio(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (typeof value !== 'string' && typeof value !== 'number') return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 1;
}

export function optionalRatio(value) {
  return isValidOptionalRatio(value) && value !== null && value !== undefined &&
    !(typeof value === 'string' && value.trim() === '')
    ? Number(value)
    : null;
}

function normalizeMemberShape(entry, b, h, name) {
  if (hasDeclaredSectionShape(entry.shape) && !SECTION_SHAPES.has(entry.shape)) {
    throw new Error(`Invalid section shape: ${name}`);
  }
  const shape = normalizeSectionShape(entry.shape);
  if (shape === 'rectangle') {
    return { shape, flangeThickness: null, webThickness: null, boxThickness: null };
  }

  const dimensionFields = shape === 'hSection'
    ? [['flangeThickness', entry.flangeThickness ?? entry.tf], ['webThickness', entry.webThickness ?? entry.tw]]
    : [['boxThickness', entry.boxThickness ?? entry.t]];
  const dimensions = {};
  for (const [field, value] of dimensionFields) {
    if (!isValidOptionalPositiveNumber(value) || optionalPositiveNumber(value) === null) {
      throw new Error(`Invalid section shape dimension ${field}: ${name}`);
    }
    dimensions[field] = optionalPositiveNumber(value);
  }

  if (shape === 'hSection') {
    if (2 * dimensions.flangeThickness >= h || dimensions.webThickness >= b) {
      throw new Error(`Invalid H-section proportions: ${name}`);
    }
    return { shape, ...dimensions, boxThickness: null };
  }
  if (2 * dimensions.boxThickness >= Math.min(b, h)) {
    throw new Error(`Invalid box-section proportions: ${name}`);
  }
  return { shape, flangeThickness: null, webThickness: null, ...dimensions };
}

function hasDeclaredSectionShape(value) {
  return value !== null && value !== undefined &&
    !(typeof value === 'string' && value.trim() === '');
}

export function isSameSectionDefinition(a, b) {
  return a.target === b.target &&
    (MEMBER_SECTION_TYPE_ALIAS[a.type] || a.type) === (MEMBER_SECTION_TYPE_ALIAS[b.type] || b.type) &&
    a.name === b.name &&
    (a.material || '') === (b.material || '') &&
    sanitizeColor(a.color, defaultColorForSection(a.target, a.type)) ===
      sanitizeColor(b.color, defaultColorForSection(b.target, b.type)) &&
    (a.target !== 'member' || (
      sanitizePositiveNumber(a.b, DEFAULT_SECTION_B_MM) === sanitizePositiveNumber(b.b, DEFAULT_SECTION_B_MM) &&
      sanitizePositiveNumber(a.h, DEFAULT_SECTION_H_MM) === sanitizePositiveNumber(b.h, DEFAULT_SECTION_H_MM) &&
      normalizeSectionShape(a.shape) === normalizeSectionShape(b.shape) &&
      optionalPositiveNumber(a.flangeThickness) === optionalPositiveNumber(b.flangeThickness) &&
      optionalPositiveNumber(a.webThickness) === optionalPositiveNumber(b.webThickness) &&
      optionalPositiveNumber(a.boxThickness) === optionalPositiveNumber(b.boxThickness) &&
      optionalPositiveNumber(a.A) === optionalPositiveNumber(b.A) &&
      optionalPositiveNumber(a.Iy) === optionalPositiveNumber(b.Iy) &&
      optionalPositiveNumber(a.Iz) === optionalPositiveNumber(b.Iz) &&
      optionalPositiveNumber(a.J) === optionalPositiveNumber(b.J) &&
      optionalPositiveNumber(a.Avy) === optionalPositiveNumber(b.Avy) &&
      optionalPositiveNumber(a.Avz) === optionalPositiveNumber(b.Avz) &&
      (sanitizeText(a.designation) || null) === (sanitizeText(b.designation) || null) &&
      (sanitizeText(a.propertySource) || null) === (sanitizeText(b.propertySource) || null) &&
      optionalRatio(a.shearAreaRatioY) === optionalRatio(b.shearAreaRatioY) &&
      optionalRatio(a.shearAreaRatioZ) === optionalRatio(b.shearAreaRatioZ) &&
      isSameMemberEnd(a.defaultEndI, b.defaultEndI) &&
      isSameMemberEnd(a.defaultEndJ, b.defaultEndJ)
    )) &&
    (a.target !== 'surface' || (
      optionalPositiveNumber(a.thickness) === optionalPositiveNumber(b.thickness) &&
      (sanitizeText(a.selfWeightMode) || null) === (sanitizeText(b.selfWeightMode) || null) &&
      (sanitizeText(a.panelDirection) || null) === (sanitizeText(b.panelDirection) || null) &&
      (sanitizeText(a.endRotationalSpring) || null) === (sanitizeText(b.endRotationalSpring) || null) &&
      ['panelToPanel', 'panelToBeam'].every(key =>
        (sanitizeText(a.edgeSprings?.[key]) || null) === (sanitizeText(b.edgeSprings?.[key]) || null)) &&
      (isBlank(a.additionalWeight) ? null : Number(a.additionalWeight)) ===
        (isBlank(b.additionalWeight) ? null : Number(b.additionalWeight))
    ));
}

export function isSameSpringDefinition(a, b) {
  return a.symbol === b.symbol &&
    ['kr', 'krY', 'krZ', 'kt', 'kv'].every(field =>
      normalizeSpringStiffness(a[field]) === normalizeSpringStiffness(b[field])) &&
    (a.memo || '') === (b.memo || '');
}

export function isSameMaterialDefinition(a, b) {
  return a.name === b.name && Number(a.E) === Number(b.E) &&
    Number(a.G) === Number(b.G) && Number(a.density) === Number(b.density);
}

// Calculates gross section properties in the CAD mm-N system. Iy follows the
// strong axis for the displayed b (width) / h (depth) convention. H-section
// fillets and welded corner radii are intentionally ignored. The box-section
// torsional constant uses the standard thin-walled closed-section median-line
// approximation, which is appropriate for typical steel RHS/box members.
export function calculateSectionPropertiesFromShape(section) {
  const b = sanitizePositiveNumber(section?.b, DEFAULT_SECTION_B_MM);
  const h = sanitizePositiveNumber(section?.h, DEFAULT_SECTION_H_MM);
  const shape = normalizeSectionShape(section?.shape);

  if (shape === 'hSection') {
    const tf = optionalPositiveNumber(section?.flangeThickness);
    const tw = optionalPositiveNumber(section?.webThickness);
    if (tf === null || tw === null || 2 * tf >= h || tw >= b) return null;
    const webHeight = h - 2 * tf;
    return {
      A: 2 * b * tf + webHeight * tw,
      Iy: (b * h ** 3 - (b - tw) * webHeight ** 3) / 12,
      Iz: 2 * (tf * b ** 3 / 12) + webHeight * tw ** 3 / 12,
      J: (2 * b * tf ** 3 + webHeight * tw ** 3) / 3,
    };
  }

  if (shape === 'boxSection') {
    const t = optionalPositiveNumber(section?.boxThickness);
    if (t === null || 2 * t >= Math.min(b, h)) return null;
    const innerB = b - 2 * t;
    const innerH = h - 2 * t;
    const medianB = b - t;
    const medianH = h - t;
    return {
      A: b * h - innerB * innerH,
      Iy: (b * h ** 3 - innerB * innerH ** 3) / 12,
      Iz: (h * b ** 3 - innerH * innerB ** 3) / 12,
      J: 2 * t * medianB ** 2 * medianH ** 2 / (medianB + medianH),
    };
  }

  const a = Math.max(b, h);
  const t = Math.min(b, h);
  const ratio = t / a;
  return {
    A: b * h,
    Iy: b * h ** 3 / 12,
    Iz: h * b ** 3 / 12,
    J: a * t ** 3 * (1 / 3 - 0.21 * ratio * (1 - ratio ** 4 / 12)),
  };
}

export function sectionProperties(section) {
  const calculated = calculateSectionPropertiesFromShape(section);
  if (!calculated) return null;
  const shape = normalizeSectionShape(section?.shape);
  const properties = {};
  const propertySource = {};
  for (const key of ['A', 'Iy', 'Iz', 'J']) {
    const explicit = optionalPositiveNumber(section?.[key]);
    properties[key] = explicit ?? calculated[key];
    propertySource[key] = explicit === null ? shape : 'explicit';
  }
  return { ...properties, propertySource };
}

// Kept as a backwards-compatible public name for callers introduced before
// H/box shape support. It now resolves the configured section shape.
export function rectangularSectionProperties(section) {
  return sectionProperties(section);
}

export function cloneSection(section) {
  return {
    ...section,
    defaultEndI: section.defaultEndI ? { ...section.defaultEndI } : undefined,
    defaultEndJ: section.defaultEndJ ? { ...section.defaultEndJ } : undefined,
    ...(section.edgeSprings ? { edgeSprings: { ...section.edgeSprings } } : {}),
  };
}

// Normalizes a member end descriptor to { condition, springSymbol }.
// When a springCatalog is given, a requested spring symbol is validated
// against it (unknown symbols fall back to the catalog's first spring);
// without a catalog the requested symbol is kept as-is, falling back to the
// built-in default spring symbol.
export function normalizeMemberEndInfo(endInfo, springCatalog = null) {
  const raw = endInfo || {};
  const rawCondition = sanitizeText(raw.condition || raw.fixity || raw.type) || 'pin';
  const condition = END_FIXITIES.has(rawCondition) ? rawCondition : 'pin';
  if (condition !== 'spring') {
    return { condition, springSymbol: null };
  }
  const requested = sanitizeText(raw.springSymbol || raw.symbol);
  if (springCatalog) {
    const spring = requested ? springCatalog.find(s => s.symbol === requested) || null : null;
    return { condition, springSymbol: spring?.symbol || springCatalog[0]?.symbol || null };
  }
  return { condition, springSymbol: requested || DEFAULT_SPRING_DEFINITIONS[0]?.symbol || null };
}

// Catalog-free member end normalization (used for raw catalog entries where
// the spring catalog may not be hydrated yet).
export function normalizeSectionDefaultEnd(endInfo) {
  return normalizeMemberEndInfo(endInfo, null);
}

export function isSameMemberEnd(a, b) {
  const endA = normalizeSectionDefaultEnd(a);
  const endB = normalizeSectionDefaultEnd(b);
  return endA.condition === endB.condition && (endA.springSymbol || null) === (endB.springSymbol || null);
}

export function sanitizeColor(value, fallback) {
  const text = sanitizeText(value);
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  const safeFallback = sanitizeText(fallback);
  return /^#[0-9a-fA-F]{6}$/.test(safeFallback) ? safeFallback.toLowerCase() : '#666666';
}

export function defaultColorForSection(target, type) {
  const normalizedType = target === 'member'
    ? (MEMBER_SECTION_TYPE_ALIAS[type] || type)
    : type;
  const def = DEFAULT_SECTION_DEFINITIONS.find(
    s => s.target === target && (MEMBER_SECTION_TYPE_ALIAS[s.type] || s.type) === normalizedType
  );
  if (def && /^#[0-9a-fA-F]{6}$/.test(def.color || '')) {
    return def.color.toLowerCase();
  }
  if (target === 'surface') {
    if (normalizedType === 'floor') return '#67a9cf';
    if (normalizedType === 'roof') return '#8b6f47';
    if (normalizedType === 'eave') return '#4f9a8a';
    if (normalizedType === 'gableWall') return '#bf6f5e';
    return '#b57a6b';
  }
  return '#666666';
}

// Rebuilds a section catalog from raw (loaded) entries on top of the default
// catalog. Throws on reserved default names redefined differently and on
// duplicates.
export function hydrateSectionCatalog(rawCatalog) {
  const catalog = createDefaultSectionCatalog();
  if (!Array.isArray(rawCatalog)) return catalog;

  const defaultsByName = new Map(
    createDefaultSectionCatalog().map(s => [s.name, s])
  );

  for (const raw of rawCatalog) {
    const normalized = normalizeCatalogSectionEntry(raw);
    if (!normalized) continue;

    const defaultDef = defaultsByName.get(normalized.name);
    if (defaultDef) {
      if (!isSameSectionDefinition(defaultDef, normalized)) {
        throw new Error(`Reserved default section name: ${normalized.name}`);
      }
      continue;
    }

    if (catalog.some(s =>
      s.target === normalized.target &&
      s.type === normalized.type &&
      s.name === normalized.name
    )) {
      throw new Error(`Duplicate section name: ${normalized.name}`);
    }
    catalog.push({ ...normalized, isDefault: false });
  }
  return catalog;
}

export function hydrateSpringCatalog(rawCatalog) {
  const catalog = createDefaultSpringCatalog();
  if (!Array.isArray(rawCatalog)) return catalog;

  const defaultsBySymbol = new Map(
    createDefaultSpringCatalog().map(s => [s.symbol, s])
  );

  for (const raw of rawCatalog) {
    const normalized = normalizeSpringEntry(raw);
    if (!normalized) continue;

    const defaultDef = defaultsBySymbol.get(normalized.symbol);
    if (defaultDef) {
      if (!isSameSpringDefinition(defaultDef, normalized)) {
        throw new Error(`Reserved default spring symbol: ${normalized.symbol}`);
      }
      continue;
    }

    if (catalog.some(s => s.symbol === normalized.symbol)) {
      throw new Error(`Duplicate spring symbol: ${normalized.symbol}`);
    }
    catalog.push({ ...normalized, isDefault: false });
  }
  return catalog;
}

export function hydrateMaterialCatalog(rawCatalog) {
  const catalog = createDefaultMaterialCatalog();
  if (!Array.isArray(rawCatalog)) return catalog;
  const loadedNames = new Set();

  for (const raw of rawCatalog) {
    const normalized = normalizeMaterialEntry(raw);
    if (!normalized) continue;
    if (loadedNames.has(normalized.name)) {
      throw new Error(`Duplicate material name: ${normalized.name}`);
    }
    loadedNames.add(normalized.name);
    const existingIndex = catalog.findIndex(material => material.name === normalized.name);
    if (existingIndex >= 0) {
      const defaultDefinition = DEFAULT_MATERIAL_DEFINITIONS.find(
        material => material.name === normalized.name
      );
      catalog[existingIndex] = {
        ...normalized,
        isDefault: Boolean(defaultDefinition && isSameMaterialDefinition(defaultDefinition, normalized)),
      };
      continue;
    }
    catalog.push({ ...normalized, isDefault: false });
  }
  return catalog;
}

function optionalPositiveNumber(value) {
  if (isBlank(value) || !isValidOptionalPositiveNumber(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
