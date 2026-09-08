import { initCoordinateInput } from './coordinate-input.js';
import { initElementList } from './element-list.js';
import { getLang, t } from '../i18n.js';
import { placementContext } from './placement-context.js';
import { initMenus } from './menus.js';
import { initInspectorTabs, showInspector } from './inspector.js';

// Connect workspace commands, dialogs and placement context.
export function initWorkspace({ state, history, ui, toolManager, activatePlanInput, openRecovery }) {
  const header = document.getElementById('app-header');
  const drawButtons = [...document.querySelectorAll('[data-draw-tool]')];
  const historyButtons = [...document.querySelectorAll('[data-history]')];
  let selectionKey = '', contextKey = '';
  const coordinates = initCoordinateInput({ state, toolManager, activatePlanInput });
  const elements = initElementList({ state, ui, toolManager, activatePlanInput });
  let summaryKey = '';
  initMenus(header, { onOpen: refresh });
  document.querySelectorAll('[data-trigger]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.trigger)?.click());
  });
  document.querySelector('[data-recovery-open]').addEventListener('click', openRecovery);
  const displayDialog = document.getElementById('display-settings-dialog');
  document.getElementById('btn-display-settings').addEventListener('click', () => displayDialog.showModal());
  displayDialog.addEventListener('keydown', event => event.stopPropagation());
  const copyDialog = document.getElementById('copy-level-dialog');
  document.getElementById('btn-copy-level-open').addEventListener('click', () => {
    ui.refreshLevelSelectors();
    copyDialog.showModal();
  });
  copyDialog.addEventListener('keydown', event => event.stopPropagation());
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
  });
  for (const button of drawButtons) {
    button.addEventListener('click', () => {
      ui.setTool(button.dataset.drawTool, button.dataset.drawType);
      document.getElementById('canvas-2d').focus({ preventScroll: true });
    });
  }
  for (const button of historyButtons) {
    button.addEventListener('click', () => toolManager.restoreHistory(button.dataset.history));
  }
  document.getElementById('btn-delete-selection').addEventListener('click', () => toolManager.deleteSelection());
  document.querySelectorAll('[data-inspector-open]').forEach(button => {
    button.addEventListener('click', () => showInspector(button.dataset.inspectorOpen, { reveal: true }));
  });
  document.getElementById('canvas-2d').addEventListener('click', () => {
    if (state.currentTool === 'select' && (state.selectedMemberIds.length || state.selectedSurfaceId || state.selectedLoadId || state.selectedSupportId)) {
      showInspector('properties');
    }
  });
  initInspectorTabs();
  function refresh() {
    coordinates.refresh();
    elements.refresh();
    const selected = [...new Set([state.selectedMemberId, ...state.selectedMemberIds,
      state.selectedSurfaceId, state.selectedLoadId, state.selectedSupportId].filter(Boolean))];
    const summary = [getLang(), state.members.length, state.surfaces.length,
      state.loads.length, state.supports.length, ...selected].join(':');
    if (summary !== summaryKey) {
      summaryKey = summary;
      document.getElementById('model-summary').textContent = t('modelCounts', {
        members: state.members.length, surfaces: state.surfaces.length,
        loads: state.loads.length, supports: state.supports.length });
      document.getElementById('model-summary').setAttribute('aria-label', t('modelSummary'));
      document.getElementById('selection-summary').textContent = selected.length
        ? t('selectionSummary', { ids: selected.join(', ') }) : t('noSelection');
    }
    for (const button of historyButtons) {
      const disabled = history[button.dataset.history + 'Stack'].length === 0;
      if (button.disabled !== disabled) button.disabled = disabled;
    }
    const selection = [state.selectedMemberId, ...state.selectedMemberIds, state.selectedSurfaceId, state.selectedLoadId, state.selectedSupportId].filter(Boolean).join(':');
    const deleteButton = document.getElementById('btn-delete-selection');
    if (deleteButton.disabled !== !selection) deleteButton.disabled = !selection;
    if (selection !== selectionKey) {
      selectionKey = selection;
      if (selection) showInspector('properties');
    }
    const key = [getLang(), state.currentTool, state.memberDraftType, state.surfaceDraftType,
      state.surfaceDraftMode, state.loadDraftType, state.activeLevelId, state.revision,
      state.getDraftSectionName('member', state.memberDraftType)].join(':');
    if (contextKey === key) return;
    contextKey = key;
    const tool = state.currentTool;
    const { type, guide, hiddenByDisplay } = placementContext(state);
    document.getElementById('placement-visibility-note').hidden = !hiddenByDisplay;
    for (const button of drawButtons) {
      const active = button.dataset.drawTool === tool && (!button.dataset.drawType || button.dataset.drawType === type);
      button.setAttribute('aria-pressed', String(active));
    }
    const level = state.levels.find(item => item.id === state.activeLevelId);
    document.getElementById('context-level').textContent = level ? level.name + ' / Z = ' + level.z + ' mm' : '';
    document.getElementById('context-tool').textContent = t(type || ({ select: 'selectTool', measure: 'measureTool', splitPoint: 'toolSplitPoint' }[tool] || tool));
    document.getElementById('placement-guide').textContent = t(guide);
    document.getElementById('app-menubar').setAttribute('aria-label', t('mainMenu'));
    document.getElementById('view-tabs').setAttribute('aria-label', t('menuView'));
    document.getElementById('canvas-2d').setAttribute('aria-label', t('planInput'));
    document.querySelector('.inspector-tabs').setAttribute('aria-label', t('modelInfo'));
    document.getElementById('property-panel').setAttribute('aria-label', t('modelInfo'));
  }
  refresh();
  // Tool transactions can notify while still inside their mutation. Refresh
  // after the transaction has pushed its history entry.
  let refreshQueued = false;
  function requestRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  }
  return { refresh, requestRefresh };
}
