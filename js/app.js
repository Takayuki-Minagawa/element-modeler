// app.js - Application entry point.
// Creates the core objects (state, history, 2D canvas, tools, UI), wires the
// feature modules together and keeps only cross-cutting concerns here:
// 2D/3D view switching, theme and language application, settings/help modals,
// model import/export buttons and the global Escape key handling.
// Feature UI lives in dedicated modules: notice.js (toasts), side-panels.js
// (panel resize/collapse), user-def-modal.js and layer-modal.js.

import { AppState } from './state.js';
import { History } from './history.js';
import { Canvas2D } from './canvas2d.js';
import { ToolManager } from './tools.js';
import { UI } from './ui.js';
import {
  exportAnalysisCSV,
  exportAnalysisJSON,
  exportCanvasPNG,
  exportDXF,
  exportJSON,
  importDXFUnderlay,
  importJSON,
  exportMemberScheduleCSV,
  exportQuantityDetailCSV,
  exportQuantitySummaryCSV,
} from './io.js';
import { initLang, setLang, getLang, t } from './i18n.js';
import { getHelpContent } from './help-content.js';
import { invalidateCssVarCache } from './dom-utils.js';
import { showNotice } from './notice.js';
import { initWorkspace } from './ui/workspace.js';
import { initPlanNavigation } from './ui/plan-navigation.js';
import { showInspector } from './ui/inspector.js';
import { initSidePanels } from './side-panels.js';
import { initUserDefModal } from './user-def-modal.js';
import { initLayerModal } from './layer-modal.js';
import { initAxesModal } from './axes-modal.js';
import { initGridFrameModal } from './grid-frame-modal.js';
import { initComboModal } from './combo-modal.js';
import { initElevationModal } from './elevation-modal.js';
import { initJoinSplitModal } from './join-split-modal.js';
import { initAnalysisSettingsModal } from './analysis-settings-modal.js';
import { initAutosave } from './autosave.js';
import { mountRecoveryUI } from './persistence/recovery-ui.js';
import { buildSampleModel } from './samples.js';
import { buildAnalysisPreflight } from './analysis-preflight.js';
import { executeModelCommand } from './commands/model-command.js';
import { applyModelImport } from './persistence/model-import.js';
import { focusIssue } from './ui/focus-issue.js';
import { mountViewerTools } from './render/viewer-tools.js';
import { initAnalysisWorkbench } from './analysis/workbench.js';

// --- Initialize ---

initLang();

const state = new AppState();
const history = new History(state);

const canvasEl = document.getElementById('canvas-2d');
const canvas2d = new Canvas2D(canvasEl, state);
const joinSplitModal = initJoinSplitModal();
let toolManager = null;

const viewerContainer = document.getElementById('viewer-3d');

// Lazy-load 3D viewer (avoids blocking app if three.js CDN fails)
let viewer3d = null;
let viewer3dLoading = false;
let viewerTools = null;
let viewerToolsState = null;
let recoveryUI = null;
let analysisWorkbench = null;
let workspace = null;
let planNavigation = null;

async function loadViewer3D() {
  if (viewer3d) return viewer3d;
  if (viewer3dLoading) return null;
  viewer3dLoading = true;
  try {
    const { Viewer3D } = await import('./viewer3d.js');
    viewer3d = new Viewer3D(viewerContainer, state);
    viewerTools = mountViewerTools(document.getElementById('viewer-tools'), viewer3d, {
      language: getLang(), onError: err => showNotice(err.message, 'error', 6500),
    });
    // Click-to-select in the 3D view: share the 2D selection state so the
    // property panel follows.
    viewer3d.onPick = (pick) => {
      if (pick) {
        state.select(pick.kind, pick.id);
        showInspector('properties');
      } else {
        state.clearSelection();
      }
      update();
    };
    return viewer3d;
  } catch (err) {
    console.error('Failed to load 3D viewer:', err);
    showNotice(t('viewer3dLoadFailed'), 'error', 6500);
    return null;
  } finally {
    viewer3dLoading = false;
  }
}

let activeView = '2d'; // '2d' | '3d'

// --- Change-driven rendering ---

function update() {
  toolManager?.syncSplitPointSelection();
  if (activeView === '2d') {
    canvas2d.requestDraw();
  } else if (viewer3d) {
    viewer3d.requestRebuild();
    const toolsState = `${state.revision}:${state.activeLevelId}`;
    if (viewerToolsState !== toolsState) {
      viewerTools?.refresh();
      viewerToolsState = toolsState;
    }
  }
  ui.updatePropertyPanel();
  ui.updateZoom(canvas2d.camera.scale);
  recoveryUI?.applyLanguage();
  analysisWorkbench?.refresh();
  workspace?.requestRefresh();
}

// --- UI ---

const JOIN_REASON_MESSAGE_KEYS = {
  'insufficient-members': 'joinMembersInsufficient',
  'missing-member': 'joinMembersMissing',
  'type-mismatch': 'joinMembersTypeMismatch',
  'unsupported-type': 'joinMembersUnsupportedType',
  'unsupported-geometry': 'joinMembersUnsupportedGeometry',
  'level-mismatch': 'joinMembersLevelMismatch',
  disconnected: 'joinMembersDisconnected',
  'non-collinear': 'joinMembersNonCollinear',
  'column-position-mismatch': 'joinMembersColumnPositionMismatch',
};

function showJoinFailure(reason) {
  showNotice(t(JOIN_REASON_MESSAGE_KEYS[reason] || 'joinMembersFailed'), 'error');
}

function getIntermediateColumnLevels(member) {
  const bottomZ = state.getLevelZ(member.levelId);
  const topZ = state.getLevelZ(member.topLevelId);
  if (!Number.isFinite(bottomZ) || !Number.isFinite(topZ)) return [];
  const minZ = Math.min(bottomZ, topZ);
  const maxZ = Math.max(bottomZ, topZ);
  return state.levels
    .filter(level => Number(level.z) > minZ && Number(level.z) < maxZ)
    .sort((a, b) => Number(a.z) - Number(b.z));
}

const ui = new UI(state, {
  onBeforePlacementChange() { toolManager?.cancelPlacement(); },
  onToolChange() { activatePlanInput(); },
  onSnapToggle() { update(); },
  onGridChange() { update(); },
  onLayerChange() { activatePlanInput(); },
  onPropertyChange() { update(); },
  onModelCommand(mutate) {
    return executeModelCommand(history, state, mutate);
  },
  onFocusIssue(issue) {
    if (!focusIssue(state, canvas2d, issue)) return;
    syncSettingsControls();
    ui.refreshLevelSelectors();
    if (activeView === '3d') {
      viewer3d?.requestRebuild();
      if (!viewer3d?.focusSelection()) {
        viewer3d?.clearIsolation();
        viewer3d?.clearClipping();
        viewerTools?.refresh();
        if (!viewer3d?.focusSelection()) {
          tab2d.click();
          // Tab activation may resize the canvas; frame against its live size.
          focusIssue(state, canvas2d, issue);
        }
      }
    }
    update();
    showNotice(getLang() === 'ja' ? '対象を表示しました。必要な表示フィルタを解除しました。' : 'Target revealed; necessary visibility filters were cleared.', 'success');
  },
  onDraftSectionChange() { showNotice(t('applyAsDraftHint'), 'success'); },
  async onJoinMembers(memberIds) {
    let validation = state.canJoinMembers(memberIds);
    if (!validation.ok) {
      showJoinFailure(validation.reason);
      return;
    }

    let sectionName = validation.sections[0];
    if (validation.sections.length > 1) {
      sectionName = await joinSplitModal.choose({
        titleKey: 'joinSelectSection',
        options: validation.sections,
        initialValue: validation.sections[0],
      });
      if (sectionName === null) return;

      // The dialog is asynchronous; validate the original selection again in
      // case the model was changed through another input path while it was open.
      validation = state.canJoinMembers(memberIds);
      if (!validation.ok) {
        showJoinFailure(validation.reason);
        return;
      }
    }

    let result = null;
    const changed = history.transact(() => {
      result = state.joinMembers(memberIds, { sectionName });
      return Boolean(result);
    });
    if (!changed || !result) {
      showJoinFailure();
      return;
    }
    state.select('member', result.memberId);
    update();
    showNotice(t('joinMembersDone', { n: result.joined }), 'success');
  },
  async onSplitMember(memberId) {
    const member = state.getMember(memberId);
    if (!member) {
      showNotice(t('splitMemberFailed'), 'error');
      return;
    }
    if (member.type !== 'beam' && member.type !== 'column') {
      showNotice(t('splitMemberUnsupported'), 'error');
      return;
    }
    if (member.geometryMode === 'explicit3d' || member.roofRole) {
      showNotice(t('splitMemberUnsupportedGeometry'), 'error');
      return;
    }

    if (member.type === 'beam') {
      if (!toolManager?.startSplitPoint(member.id)) {
        showNotice(t('splitMemberFailed'), 'error');
        return;
      }
      showNotice(t('splitAtPointHint'), 'success');
      return;
    }

    const intermediateLevels = getIntermediateColumnLevels(member);
    if (!intermediateLevels.length) {
      showNotice(t('splitColumnNoIntermediateLevel'), 'error');
      return;
    }
    let levelId = intermediateLevels[0].id;
    if (intermediateLevels.length > 1) {
      levelId = await joinSplitModal.choose({
        titleKey: 'splitColumnSelectLevel',
        options: intermediateLevels.map(level => ({
          value: level.id,
          label: `${level.name} (z=${level.z})`,
        })),
        initialValue: levelId,
      });
      if (levelId === null) return;
    }

    let result = null;
    const changed = history.transact(() => {
      result = state.splitColumnAtLevel(memberId, { levelId });
      return Boolean(result);
    });
    if (!changed || !result) {
      showNotice(t('splitMemberFailed'), 'error');
      return;
    }
    state.selectMembers(result.createdMemberIds);
    update();
    showNotice(t('splitMemberDone', { n: result.createdMemberIds.length }), 'success');
  },
  onCopyLevel(sourceLevelId, targetLevelId) {
    if (!sourceLevelId || !targetLevelId || sourceLevelId === targetLevelId) {
      showNotice(t('copyLevelInvalid'), 'error');
      return;
    }
    let counts;
    const changed = history.transact(() => {
      counts = state.copyLevelElements(sourceLevelId, targetLevelId);
      return counts.members + counts.surfaces + counts.loads + counts.supports > 0;
    });
    if (!changed) {
      showNotice(t('copyLevelNoItems'), 'error');
      return;
    }
    update();
    showNotice(
      t('copyLevelDone', {
        members: counts.members,
        surfaces: counts.surfaces,
        loads: counts.loads,
        supports: counts.supports,
      }),
      'success'
    );
  },
  onModelCheck() {
    const issues = state.validateModel();
    showNotice(
      issues.length
        ? t('modelCheckDone', { count: issues.length })
        : t('modelCheckNoIssues'),
      issues.length ? 'error' : 'success'
    );
  },
  onBeforeBigChange() {
    history.save();
  },
});

// Whole-model history restores can change levels and display settings. Keep
// their controls synchronized before ToolManager requests the next render.
history.setOnRestore(() => {
  syncSettingsControls();
  ui.refreshLevelSelectors();
  ui.refreshToolState();
});

// --- Tools ---

toolManager = new ToolManager(canvas2d, state, history, update, {
  onPanModeChange() { planNavigation?.refresh(); },
  onTemporaryToolChange() {
    ui.refreshToolState();
  },
  onSplitPointComplete(result) {
    showNotice(t('splitMemberDone', { n: result.createdMemberIds.length }), 'success');
  },
  onSplitPointFailed() {
    showNotice(t('splitMemberFailed'), 'error');
  },
});

planNavigation = initPlanNavigation({ state, canvas2d, toolManager, onUpdate: update });

// --- Side Panels ---

initSidePanels({
  onLayoutRefresh() {
    canvas2d.resize();
    if (viewer3d) viewer3d.resize();
    update();
  },
});

// --- View Tab Switching ---

const tab2d = document.getElementById('tab-2d');
const tab3d = document.getElementById('tab-3d');

function activatePlanInput() {
  activeView = '2d';
  tab2d.classList.add('active');
  tab3d.classList.remove('active');
  tab2d.setAttribute('aria-pressed', 'true');
  tab3d.setAttribute('aria-pressed', 'false');
  canvasEl.hidden = false;
  planNavigation.setVisible(true);
  viewerContainer.hidden = true;
  document.getElementById('viewer-tools').hidden = true;
  viewer3d?.setActive(false);
  canvas2d.setActive(true);
  canvas2d.resize();
  update();
}

tab2d.addEventListener('click', activatePlanInput);

tab3d.addEventListener('click', async () => {
  activeView = '3d';
  tab3d.classList.add('active');
  tab2d.classList.remove('active');
  tab2d.setAttribute('aria-pressed', 'false');
  tab3d.setAttribute('aria-pressed', 'true');
  canvasEl.hidden = true;
  toolManager.cancelPan({ releaseSpace: true });
  planNavigation.setVisible(false);
  canvas2d.setActive(false);
  viewerContainer.hidden = false;
  document.getElementById('viewer-tools').hidden = false;
  const v = await loadViewer3D();
  if (v && activeView === '3d') {
    v.startRendering();
    viewerTools?.refresh();
  }
});

// --- Export / Import ---

document.getElementById('btn-export').addEventListener('click', () => {
  exportJSON(state);
  showNotice(t('cadExported'), 'success');
});

document.getElementById('btn-quantity-export')?.addEventListener('click', () => {
  exportQuantitySummaryCSV(state);
  showNotice(t('quantityCsvExported'), 'success');
});

document.getElementById('btn-quantity-detail-export')?.addEventListener('click', () => {
  exportQuantityDetailCSV(state);
  showNotice(t('quantityDetailCsvExported'), 'success');
});

document.getElementById('btn-member-schedule-export')?.addEventListener('click', () => {
  exportMemberScheduleCSV(state);
  showNotice(t('memberScheduleCsvExported'), 'success');
});

function runAnalysisExport(exporter, successKey) {
  const preflight = buildAnalysisPreflight(state);
  ui.renderAnalysisPreflight(preflight);
  if (!preflight.canExport) {
    showNotice(t('analysisPreflightBlocked', { count: preflight.summary.errors }), 'error');
    return;
  }
  exporter(state, { model: preflight.model });
  showNotice(
    preflight.summary.warnings
      ? t('analysisExportedWithWarnings', { count: preflight.summary.warnings })
      : t(successKey),
    preflight.summary.warnings ? 'warning' : 'success'
  );
}

document.getElementById('btn-analysis-export')?.addEventListener('click', () => {
  runAnalysisExport(exportAnalysisJSON, 'analysisExported');
});

document.getElementById('btn-analysis-csv-export')?.addEventListener('click', () => {
  runAnalysisExport(exportAnalysisCSV, 'analysisCsvExported');
});

document.getElementById('btn-dxf-export')?.addEventListener('click', () => {
  exportDXF(state, { levelId: 'all' });
  showNotice(t('dxfExported'), 'success');
});

document.getElementById('btn-png-export')?.addEventListener('click', () => {
  canvas2d.draw({ force: true });
  exportCanvasPNG(canvasEl, state);
  showNotice(t('pngExported'), 'success');
});

// --- Model cleanup (node merge / member split) ---

document.getElementById('btn-merge-nodes')?.addEventListener('click', () => {
  let result;
  history.transact(() => {
    result = state.mergeNearbyNodes();
    return result.mergedNodes > 0;
  });
  update();
  showNotice(
    result.mergedNodes
      ? t('mergeNodesDone', { n: result.mergedNodes })
      : t('mergeNodesNone'),
    'success'
  );
});

document.getElementById('btn-split-members')?.addEventListener('click', () => {
  let result;
  history.transact(() => {
    result = state.splitIntersectingMembers();
    return result.splitMembers > 0;
  });
  update();
  showNotice(
    result.splitMembers
      ? t('splitMembersDone', { n: result.splitMembers, c: result.createdMembers })
      : t('splitMembersNone'),
    'success'
  );
});

// --- DXF underlay ---

document.getElementById('btn-underlay-import')?.addEventListener('click', () => {
  document.getElementById('file-underlay-import').click();
});

document.getElementById('file-underlay-import')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const { count } = await importDXFUnderlay(file, state);
    state.updateSetting('showUnderlay', true);
    const chk = document.getElementById('chk-show-underlay');
    if (chk) chk.checked = true;
    update();
    showNotice(t('underlayImported', { n: count }), 'success');
  } catch (err) {
    showNotice(t('underlayImportFailed') + err.message, 'error', 6500);
  }
  e.target.value = '';
});

document.getElementById('btn-underlay-clear')?.addEventListener('click', () => {
  if (state.clearUnderlay()) {
    update();
    showNotice(t('underlayCleared'), 'success');
  }
});

document.getElementById('chk-show-underlay')?.addEventListener('change', (e) => {
  state.updateSetting('showUnderlay', e.target.checked);
  update();
});

document.getElementById('chk-show-axes')?.addEventListener('change', (e) => {
  state.updateSetting('showAxes', e.target.checked);
  update();
});

document.getElementById('btn-import-trigger').addEventListener('click', () => {
  document.getElementById('file-import').click();
});

// Re-syncs the toolbar controls with state.settings after any whole-model
// replacement (file import, autosave restore, sample load).
function syncSettingsControls() {
  document.getElementById('chk-snap').checked = state.settings.snap;
  document.getElementById('chk-show-supports').checked = state.settings.showSupports !== false;
  document.getElementById('chk-wide-pick').checked = !!state.settings.widePick;
  document.getElementById('sel-grid').value = String(state.settings.gridSize);
  const chkAxes = document.getElementById('chk-show-axes');
  if (chkAxes) chkAxes.checked = state.settings.showAxes !== false;
  const chkUnderlay = document.getElementById('chk-show-underlay');
  if (chkUnderlay) chkUnderlay.checked = state.settings.showUnderlay !== false;
  ui.refreshToolState();
}

document.getElementById('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await importJSON(file, state, history);
    syncSettingsControls();
    ui.refreshLevelSelectors();
    update();
    showNotice(t('cadImported'), 'success');
  } catch (err) {
    showNotice(t('importFailed') + err.message, 'error', 6500);
  }
  e.target.value = '';
});

// --- Feature Modals (user definitions / layers) ---

const userDefModal = initUserDefModal({
  state,
  history,
  onModelChange: update,
  refreshDraftSectionSelectors: () => ui.refreshDraftSectionSelectors(),
});

const analysisSettingsModal = initAnalysisSettingsModal({
  state,
  onSave(settings) {
    history.transact(() => state.updateAnalysisSettings(settings));
    update();
    showNotice(t('analysisSettingsSaved'), 'success');
  },
});

const layerModal = initLayerModal({
  state,
  history,
  onModelChange: update,
  refreshLevelSelectors: () => ui.refreshLevelSelectors(),
});

const axesModal = initAxesModal({
  state,
  history,
  onModelChange: update,
});

const gridFrameModal = initGridFrameModal({
  state,
  history,
  onModelChange: update,
  syncSettingsControls,
  refreshLevelSelectors: () => ui.refreshLevelSelectors(),
  hideSettingsModal,
});

const comboModal = initComboModal({
  state,
  history,
  onModelChange: update,
});

const elevationModal = initElevationModal({ state });

analysisWorkbench = initAnalysisWorkbench({
  state, host: document.getElementById('analysis-tools'),
  onSelect: pick => {
    ui.callbacks.onFocusIssue({ elementType: 'member', elementId: pick.sourceId });
  },
});

// --- Autosave / crash recovery ---

const recoveryStartupRevision = state.revision;
const autosave = initAutosave({
  state, history,
  onRestore() {
    syncSettingsControls();
    ui.refreshLevelSelectors();
    update();
  },
});
recoveryUI = mountRecoveryUI({ autosave, host: document.getElementById('recovery-tools') });
void autosave.ready.then(async ready => {
  if (!ready) return;
  try {
    const entries = await autosave.listGenerations();
    if (entries.length && state.revision === recoveryStartupRevision) await recoveryUI.open();
  } catch (error) {
    console.error('Recovery history unavailable:', error);
  }
});

// --- Sample models ---

function loadSample(sampleId) {
  try {
    applyModelImport(buildSampleModel(sampleId), state, history);
    syncSettingsControls();
    ui.refreshLevelSelectors();
    hideSettingsModal();
    update();
    showNotice(t('sampleLoaded'), 'success');
  } catch (err) {
    console.error('Sample load failed:', err);
    showNotice(t('sampleLoadFailed'), 'error', 6500);
  }
}

document.getElementById('btn-sample-gable')?.addEventListener('click', () => loadSample('gableHouse'));
document.getElementById('btn-sample-frame')?.addEventListener('click', () => loadSample('twoStoryFrame'));
document.getElementById('btn-grid-frame')?.addEventListener('click', gridFrameModal.show);

document.getElementById('btn-open-combos')?.addEventListener('click', () => {
  hideSettingsModal();
  comboModal.show();
});

// --- Settings Modal ---

const settingsModal = document.getElementById('settings-modal');
const settingsThemeSelect = document.getElementById('settings-theme');
const settingsLangSelect = document.getElementById('settings-lang');

function applyI18nTo(root) {
  if (!root) return;
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('lineframe-theme', theme);
  invalidateCssVarCache();
  canvas2d.requestDraw();
  if (viewer3d) viewer3d.applyTheme();
  if (settingsThemeSelect) settingsThemeSelect.value = theme;
}

function applyLang(lang) {
  setLang(lang);
  ui.applyLanguage();
  planNavigation?.refresh();
  if (settingsLangSelect) settingsLangSelect.value = lang;
  applyI18nTo(settingsModal);
  gridFrameModal.applyLanguage();
  userDefModal.applyLanguage();
  analysisSettingsModal.applyLanguage();
  layerModal.clearFormError();
  analysisWorkbench?.applyLanguage();
  if (viewer3d) {
    viewerTools?.dispose();
    viewerTools = mountViewerTools(document.getElementById('viewer-tools'), viewer3d, {
      language: lang, onError: err => showNotice(err.message, 'error', 6500),
    });
  }
}

function showSettingsModal() {
  settingsThemeSelect.value = document.documentElement.dataset.theme || 'dark';
  settingsLangSelect.value = getLang();
  applyI18nTo(settingsModal);
  settingsModal.classList.add('visible');
}

function hideSettingsModal() {
  settingsModal.classList.remove('visible');
}

document.getElementById('btn-settings').addEventListener('click', showSettingsModal);
document.getElementById('btn-settings-close').addEventListener('click', hideSettingsModal);

settingsThemeSelect.addEventListener('change', (e) => {
  applyTheme(e.target.value);
});

settingsLangSelect.addEventListener('change', (e) => {
  applyLang(e.target.value);
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) hideSettingsModal();
});

document.getElementById('btn-open-user-def').addEventListener('click', () => {
  hideSettingsModal();
  userDefModal.show();
});

// Apply initial theme and language
const savedTheme = localStorage.getItem('lineframe-theme') || 'dark';
applyTheme(savedTheme);
ui.applyLanguage();

// --- Help Modal ---

const helpModal = document.getElementById('help-modal');
const helpBody = document.getElementById('help-body');

function showHelpModal() {
  helpBody.innerHTML = getHelpContent(getLang());
  const titleEl = helpModal.querySelector('[data-i18n="helpTitle"]');
  if (titleEl) titleEl.textContent = t('helpTitle');
  const closeEl = helpModal.querySelector('[data-i18n="helpClose"]');
  if (closeEl) closeEl.textContent = t('helpClose');
  helpModal.classList.add('visible');
}

function hideHelpModal() {
  helpModal.classList.remove('visible');
}

document.getElementById('btn-open-help').addEventListener('click', () => {
  hideSettingsModal();
  showHelpModal();
});

document.getElementById('btn-help-close').addEventListener('click', hideHelpModal);

helpModal.addEventListener('click', (e) => {
  if (e.target === helpModal) hideHelpModal();
});

// --- Global keyboard handling ---

// Close modals on Escape.
// User definition modals are intentionally excluded: they hold in-progress
// input, and Escape is also used by the IME to cancel a conversion, so closing
// them must require an explicit button. When a user-def modal is open, Escape
// is swallowed so it never falls through and closes another modal underneath.
window.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (e.key === 'Escape') {
    if (userDefModal.isOpen()) {
      e.stopPropagation();
    } else if (analysisSettingsModal.isOpen()) {
      analysisSettingsModal.hide();
      e.stopPropagation();
    } else if (helpModal.classList.contains('visible')) {
      hideHelpModal();
      e.stopPropagation();
    } else if (layerModal.isOpen()) {
      layerModal.hide();
      e.stopPropagation();
    } else if (axesModal.isOpen()) {
      axesModal.hide();
      e.stopPropagation();
    } else if (gridFrameModal.isOpen()) {
      gridFrameModal.hide();
      e.stopPropagation();
    } else if (comboModal.isOpen()) {
      comboModal.hide();
      e.stopPropagation();
    } else if (elevationModal.isOpen()) {
      elevationModal.hide();
      e.stopPropagation();
    } else if (settingsModal.classList.contains('visible')) {
      hideSettingsModal();
      e.stopPropagation();
    }
  }
}, true);

// --- Plan-focused workspace ---
workspace = initWorkspace({ state, history, ui, toolManager, activatePlanInput, openRecovery: () => recoveryUI.open() });

// --- Start ---

// Expose for testing/debugging
window._app = { state, history, canvas2d, ui, autosave, update, get viewer3d() { return viewer3d; } };

update();
