// analysis-settings.js - Persistent settings that describe how analysis
// exports should assemble modal mass. The exporter consumes these values but
// intentionally leaves all unit conversion and mass assembly to downstream
// adapters.

import { LOAD_CASES } from './constants.js';

export const SELF_WEIGHT_MODES = new Set(['fromDensity', 'includedInDL']);

export const DEFAULT_MASS_SOURCE_FACTORS = Object.freeze({
  DL: 1,
  LL: 0.3,
  EQX: 0,
  EQY: 0,
  WX: 0,
  WY: 0,
});

export function createDefaultAnalysisSettings() {
  return {
    massSources: { ...DEFAULT_MASS_SOURCE_FACTORS },
    selfWeightMode: 'fromDensity',
    ignoreShearDeformation: null,
  };
}

export function normalizeAnalysisSettings(rawSettings) {
  const raw = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
  if (raw.ignoreShearDeformation !== null && raw.ignoreShearDeformation !== undefined &&
      typeof raw.ignoreShearDeformation !== 'boolean') {
    throw new Error('ignoreShearDeformation must be a boolean or null');
  }
  const rawMassSources = raw.massSources && typeof raw.massSources === 'object'
    ? raw.massSources
    : null;
  const massSources = {};

  for (const loadCase of LOAD_CASES) {
    if (rawMassSources && Object.hasOwn(rawMassSources, loadCase)) {
      massSources[loadCase] = optionalNonNegativeNumber(rawMassSources[loadCase]);
    } else {
      massSources[loadCase] = DEFAULT_MASS_SOURCE_FACTORS[loadCase];
    }
  }

  return {
    massSources,
    selfWeightMode: SELF_WEIGHT_MODES.has(raw.selfWeightMode)
      ? raw.selfWeightMode
      : 'fromDensity',
    ignoreShearDeformation: typeof raw.ignoreShearDeformation === 'boolean'
      ? raw.ignoreShearDeformation : null,
  };
}

export function isDefaultAnalysisSettings(settings) {
  const normalized = normalizeAnalysisSettings(settings);
  return normalized.selfWeightMode === 'fromDensity' &&
    normalized.ignoreShearDeformation === null &&
    LOAD_CASES.every(loadCase =>
      normalized.massSources[loadCase] === DEFAULT_MASS_SOURCE_FACTORS[loadCase]
    );
}

function optionalNonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
