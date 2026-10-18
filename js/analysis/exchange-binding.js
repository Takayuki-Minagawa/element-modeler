import { buildAnalysisModel } from '../analysis-export.js';
import { hasProvisionalEdit } from '../domain/provisional-edit.js';
import { modelFingerprint } from './fingerprint.js';
import { CAD_FINGERPRINT_VERSION, EXCHANGE_FORMAT, createExchange, summarizeExchange, validateExchange } from './exchange.js';

// Hash the CAD's structural content, not its camera, history, file name or the
// attached original itself. Keep the unmerged CAD geometry as well as resolved
// analysis properties: the v2 exporter alone can merge near-coincident nodes.
export function cadFingerprint(state) {
  const saved = state.toJSON();
  const resolved = buildAnalysisModel(state);
  delete resolved.meta;
  const payload = { fingerprintVersion: CAD_FINGERPRINT_VERSION, unit: state.meta?.unit ?? 'mm', resolved };
  for (const key of ['nodes', 'members', 'surfaces', 'loads', 'supports', 'levels', 'loadCombinations', 'analysisSettings']) {
    payload[key] = saved[key];
  }
  const clean = value => {
    if (Array.isArray(value)) return value.map(clean);
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value)
        .filter(([key, item]) => item !== undefined && !['color', 'label', 'memo', 'isDefault'].includes(key))
        .map(([key, item]) => [key, clean(item)]));
    }
    return value;
  };
  // modelFingerprint captures the complete payload before yielding for SHA-256.
  return modelFingerprint(clean(payload));
}

function assertEditable(state) {
  if (hasProvisionalEdit(state)) throw new Error('Finish or cancel the current edit first');
}

function requestGuard(state, isCurrent) {
  assertEditable(state);
  const revision = state.revision;
  const original = state.analysisExchange;
  return () => {
    assertEditable(state);
    if (state.revision !== revision || state.analysisExchange !== original || !isCurrent()) {
      throw new Error('Model or request changed; retry with the current CAD model');
    }
  };
}

function replaceExchange(state, exchange, history) {
  const apply = () => { state.analysisExchange = exchange; state._touch(); return true; };
  if (history) history.transact(apply);
  else apply();
}

export async function importAnalysisExchange(state, data, history, { isCurrent = () => true } = {}) {
  const guard = requestGuard(state, isCurrent);
  // Clone now, before awaiting; callers cannot change the input during hashing.
  const candidate = structuredClone(data);
  let exchange;
  if (candidate?.format === EXCHANGE_FORMAT) {
    exchange = validateExchange(candidate); // Never rebind an existing envelope.
  } else {
    exchange = createExchange(candidate, await cadFingerprint(state));
  }
  guard();
  replaceExchange(state, exchange, history);
  return structuredClone(exchange);
}

export function detachAnalysisExchange(state, history) {
  assertEditable(state);
  if ((state.analysisExchange === null || state.analysisExchange === undefined)) return false;
  replaceExchange(state, null, history);
  return true;
}

export function exportExchange(state) {
  if ((state.analysisExchange === null || state.analysisExchange === undefined)) throw new Error('No associated analysis original');
  return validateExchange(state.analysisExchange);
}

export async function exchangeStatus(state) {
  if ((state.analysisExchange === null || state.analysisExchange === undefined)) return { status: 'none', summary: null };
  const guard = requestGuard(state, () => true);
  const exchange = exportExchange(state);
  const fingerprint = await cadFingerprint(state);
  guard();
  return { status: fingerprint === exchange.sourceCad.fingerprint ? 'current' : 'stale', summary: summarizeExchange(exchange) };
}

export async function exportNativeAnalysisModel(state, { isCurrent = () => true } = {}) {
  const guard = requestGuard(state, isCurrent);
  const exchange = exportExchange(state);
  const fingerprint = await cadFingerprint(state);
  guard();
  if (fingerprint !== exchange.sourceCad.fingerprint) {
    throw new Error('CAD structure changed: the associated analysis original is stale');
  }
  return structuredClone(exchange.model);
}
