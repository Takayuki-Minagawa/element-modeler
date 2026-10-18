// autosave.js - Serialized asynchronous recovery saves and observable status.

import { IndexedDBGenerationStore } from './persistence/indexeddb-store.js';
import { LEGACY_AUTOSAVE_KEY, migrateLegacyAutosave } from './persistence/legacy-migration.js';
import { captureRecoveryData } from './persistence/snapshot.js';
import { applyModelImport } from './persistence/model-import.js';
import { LOAD_CASES } from './constants.js';
import { hasProvisionalEdit } from './domain/provisional-edit.js';
import { isDefaultAnalysisSettings } from './analysis-settings.js';
import { createDefaultLoadCombinations } from './state.js';
import { createDefaultSettings, normalizeSettings } from './display-settings.js';

const AUTOSAVE_KEY = LEGACY_AUTOSAVE_KEY;
const AUTOSAVE_INTERVAL_MS = 20000;

function loadCombinationsEdited(list) {
  if (!Array.isArray(list)) return false;
  const defaults = createDefaultLoadCombinations();
  if (list.length !== defaults.length) return true;
  return list.some((combo, i) =>
    combo?.id !== defaults[i].id ||
    combo?.name !== defaults[i].name ||
    LOAD_CASES.some(cs => (combo?.factors?.[cs] || 0) !== (defaults[i].factors[cs] || 0))
  );
}

function settingsEdited(raw) {
  if (!raw) return false;
  const settings = normalizeSettings(raw);
  const defaults = createDefaultSettings();
  return Object.keys(defaults).some(key => settings[key] !== defaults[key]);
}

// A snapshot is worth keeping when it contains any drawn elements, grid axes,
// an underlay, edited load combinations, or non-default display settings
// (settings are part of the saved model too). Exported for tests.
export function modelHasContent(data) {
  if (!data) return false;
  if (data.analysisExchange !== null && data.analysisExchange !== undefined) return true;
  const count =
    (data.nodes?.length || 0) +
    (data.members?.length || 0) +
    (data.surfaces?.length || 0) +
    (data.loads?.length || 0) +
    (data.supports?.length || 0) +
    (data.axes?.length || 0) +
    (data.underlay?.entities?.length || 0);
  if (count > 0) return true;
  const materialCatalogEdited = Array.isArray(data.materialCatalog) &&
    data.materialCatalog.some(material => material?.isDefault === false);
  return loadCombinationsEdited(data.loadCombinations) ||
    settingsEdited(data.settings) ||
    !isDefaultAnalysisSettings(data.analysisSettings) ||
    materialCatalogEdited ||
    [data.sectionCatalog, data.springCatalog].some(catalog =>
      Array.isArray(catalog) && catalog.some(entry => entry?.isDefault === false));
}

export function readAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return modelHasContent(parsed?.data) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // storage unavailable - nothing to clear
  }
}

// Legacy read/clear exports above remain synchronous for existing integrations.
// New integrations must use controller.ready and listGenerations(), and remove
// the old startup prompt. mountRecoveryUI() provides a generation picker.
export function initAutosave({
  state,
  history,
  store = new IndexedDBGenerationStore(),
  storage,
  eventTarget = globalThis.window,
  documentTarget = globalThis.document,
  intervalMs = AUTOSAVE_INTERVAL_MS,
  now = () => new Date().toISOString(),
  onStatus,
  onError,
  onRestore,
} = {}) {
  let initialized = false;
  const initialRevision = state.revision;
  let expectedHead = null;
  let lastSavedRevision = null;
  let lastSavedAt = null;
  let phase = 'idle';
  let error = null;
  let notifiedError = null;
  let stopped = false;
  let tail = Promise.resolve();
  const listeners = new Set();
  if (onStatus) listeners.add(onStatus);

  const getStatus = () => ({
    status: state.settings?.autosave === false ? 'disabled'
      : ['idle', 'saved'].includes(phase) && state.revision !== lastSavedRevision ? 'pending' : phase,
    lastSavedAt,
    lastSavedRevision,
    dirty: state.revision !== lastSavedRevision,
    error,
  });
  // UI callback failures must never turn a committed write into a failed save.
  const call = (fn, value) => {
    try { fn?.(value); } catch (callbackError) { console.error(callbackError); }
  };
  const emit = () => { for (const listener of listeners) call(listener, getStatus()); };
  const failed = cause => {
    error = cause;
    phase = 'error';
    emit();
    const signature = `${cause.name}:${cause.message}`;
    if (signature !== notifiedError) call(onError, cause);
    notifiedError = signature;
  };
  const enqueue = operation => {
    const result = tail.then(operation);
    tail = result.catch(() => {});
    return result;
  };
  const initialize = async () => {
    if (initialized) return;
    // A fresh untouched canvas must not replace a previous session's recovery
    // head every twenty seconds while the user is deciding what to restore.
    if (state.revision === initialRevision && !modelHasContent(captureRecoveryData(state))) {
      lastSavedRevision = initialRevision;
    }
    // Resolve storage inside the try/catch boundary: its getter itself may
    // throw SecurityError in privacy-restricted browser contexts.
    const legacyStorage = storage === undefined ? globalThis.localStorage : storage;
    await migrateLegacyAutosave({ storage: legacyStorage, store, state });
    const entries = await store.list();
    expectedHead = entries[0]?.id ?? null;
    lastSavedAt = entries[0]?.savedAt ?? null;
    initialized = true;
  };

  const ready = enqueue(async () => {
    try { await initialize(); emit(); return true; }
    catch (cause) { failed(cause); return false; }
  });

  const saveNow = () => enqueue(async () => {
    if (stopped) return null;
    if (state.settings?.autosave === false) { emit(); return null; }
    try {
      await initialize();
      if (hasProvisionalEdit(state)) { emit(); return null; }
      if (state.revision === lastSavedRevision) { emit(); return null; }
      // Capture revision and data together, before the first write await.
      const revision = state.revision;
      const data = captureRecoveryData(state);
      if (expectedHead === null && lastSavedRevision === null && !modelHasContent(data)) {
        lastSavedRevision = revision;
        emit();
        return null;
      }
      phase = 'saving';
      error = null;
      emit();
      const entry = await store.append({ data, revision, savedAt: now() }, { expectedHead });
      expectedHead = entry.id;
      lastSavedRevision = revision;
      lastSavedAt = entry.savedAt;
      phase = 'saved';
      notifiedError = null;
      emit();
      return entry;
    } catch (cause) {
      failed(cause);
      return null;
    }
  });

  const listGenerations = async () => {
    try { return await store.list(); }
    catch (cause) { failed(cause); throw cause; }
  };
  const restoreGeneration = id => {
    const requestedRevision = state.revision;
    return enqueue(async () => {
      try {
        const entry = await store.get(id);
        if (!entry) throw new Error('Recovery generation no longer exists');
        const entries = await store.list();
        if (state.revision !== requestedRevision || hasProvisionalEdit(state)) throw new Error('Model changed while recovery was loading; finish editing and choose the generation again');
        applyModelImport(entry.data, state, history, { preserveCatalogs: false });
        // Choosing a generation explicitly acknowledges the current DB head.
        // Subsequent writes still use CAS and cannot overwrite unseen writes.
        expectedHead = entries[0]?.id ?? null;
        initialized = true;
        lastSavedRevision = null;
        phase = 'pending';
        error = null;
        notifiedError = null;
        emit();
        call(onRestore, entry);
        return entry;
      } catch (cause) { failed(cause); throw cause; }
    });
  };

  // Also save when a tab becomes hidden. No reliance on completion of an
  // asynchronous beforeunload handler; the periodic timer creates checkpoints.
  const visibilityChange = () => {
    if (documentTarget?.visibilityState === 'hidden') void saveNow();
    else emit();
  };
  const pageHide = () => { void saveNow(); };
  const timer = intervalMs > 0 ? setInterval(() => { void saveNow(); }, intervalMs) : null;
  documentTarget?.addEventListener('visibilitychange', visibilityChange);
  eventTarget?.addEventListener('pagehide', pageHide);

  return {
    ready, saveNow, listGenerations, restoreGeneration, getStatus,
    subscribe(listener) {
      listeners.add(listener);
      call(listener, getStatus());
      return () => listeners.delete(listener);
    },
    stop() {
      stopped = true;
      if (timer !== null) clearInterval(timer);
      documentTarget?.removeEventListener('visibilitychange', visibilityChange);
      eventTarget?.removeEventListener('pagehide', pageHide);
      listeners.clear();
      // An already submitted write may still commit; queued saves are skipped.
      return tail;
    },
  };
}
