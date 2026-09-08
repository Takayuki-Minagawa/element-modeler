import { getLang, t } from '../i18n.js';

export function showInspector(name, { reveal = false } = {}) {
  const panel = document.getElementById('inspector-' + name);
  if (!panel) return;
  for (const tab of document.querySelectorAll('[data-inspector-tab]')) {
    const active = tab.dataset.inspectorTab === name;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !active;
  }
  if (reveal && document.body.classList.contains('property-collapsed')) {
    document.getElementById('btn-toggle-property').click();
  }
}

// Disclosure menus contain commands and native form controls.
export function initWorkspace({ state, history, ui, toolManager, update, openRecovery }) {
  const header = document.getElementById('app-header');
  const triggers = [...header.querySelectorAll('.menu-trigger')];
  const drawButtons = [...document.querySelectorAll('[data-draw-tool]')];
  const historyButtons = [...document.querySelectorAll('[data-history]')];
  let openTrigger = null, selectionKey = '', contextKey = '';
  function closeMenu(restoreFocus = false) {
    if (!openTrigger) return;
    const trigger = openTrigger;
    document.getElementById(trigger.getAttribute('aria-controls')).hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    openTrigger = null;
    if (restoreFocus) trigger.focus();
  }
  function openMenu(trigger) {
    closeMenu();
    refresh();
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    openTrigger = trigger;
    panel.style.left = '0px';
    const rect = panel.getBoundingClientRect();
    panel.style.left = Math.min(0, window.innerWidth - rect.right - 8) + 'px';
  }
  for (const trigger of triggers) {
    trigger.addEventListener('click', () => openTrigger === trigger ? closeMenu() : openMenu(trigger));
  }
  document.addEventListener('pointerdown', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  document.addEventListener('focusin', event => {
    if (!header.contains(event.target)) closeMenu();
  });
  window.addEventListener('resize', () => closeMenu());
  // Close before command handlers run, so a newly opened dialog keeps focus.
  header.addEventListener('click', event => {
    if (event.target.closest('.menu-dropdown button')) closeMenu(true);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.isComposing || !openTrigger && !header.contains(event.target)) return;
    if (event.target.closest('dialog, .modal-overlay')) return;
    if (!openTrigger && !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Home', 'End', ' ', 'Enter'].includes(event.key)) return;
    if (event.key === 'Escape' && openTrigger) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    // Preserve native editing but keep CAD shortcuts from reaching the model.
    event.stopPropagation();
    if (event.target.matches('input, select, textarea')) return;
    const trigger = event.target.closest('.menu-trigger');
    if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const index = triggers.indexOf(trigger || openTrigger);
      const next = triggers[(index + (event.key === 'ArrowRight' ? 1 : triggers.length - 1)) % triggers.length];
      if (openTrigger) openMenu(next);
      next.focus();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (trigger) openMenu(trigger);
      if (!openTrigger) return;
      const panel = document.getElementById(openTrigger.getAttribute('aria-controls'));
      const items = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(el => el.getClientRects().length);
      const index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1) : (index + 1) % items.length;
      items[next]?.focus();
    }
  }, true);
  document.querySelectorAll('[data-trigger]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.trigger)?.click());
  });
  document.querySelector('[data-recovery-open]').addEventListener('click', openRecovery);
  const copyDialog = document.getElementById('copy-level-dialog');
  document.getElementById('btn-copy-level-open').addEventListener('click', () => {
    ui.refreshLevelSelectors();
    copyDialog.showModal();
  });
  copyDialog.addEventListener('keydown', event => event.stopPropagation());
  document.querySelectorAll('[data-close-dialog]').forEach(button => {
    button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close());
  });
  function chooseTool(tool, type) {
    toolManager.cancelPlacement();
    state.currentTool = tool;
    if (type && tool === 'member') state.memberDraftType = type;
    if (type && tool === 'surface') state.surfaceDraftType = type;
    ui.refreshLevelSelectors();
    ui.refreshToolState();
    document.getElementById('tab-2d').click();
    update();
    document.getElementById('canvas-2d').focus({ preventScroll: true });
  }
  for (const button of drawButtons) {
    button.addEventListener('click', () => chooseTool(button.dataset.drawTool, button.dataset.drawType));
  }
  document.getElementById('toolbar').addEventListener('change', event => {
    if (['sel-tool', 'sel-member-type', 'sel-surface-type', 'sel-surface-mode', 'sel-load-type', 'sel-active-layer'].includes(event.target.id)) {
      toolManager.cancelPlacement();
      ui.refreshToolState();
      document.getElementById('tab-2d').click();
    }
    refresh();
  });
  for (const button of historyButtons) {
    button.addEventListener('click', () => {
      toolManager.cancelPlacement();
      if (history[button.dataset.history]()) update();
      refresh();
    });
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
  const tabs = [...document.querySelectorAll('[data-inspector-tab]')];
  for (const tab of tabs) {
    tab.addEventListener('click', () => showInspector(tab.dataset.inspectorTab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
      showInspector(tabs[next].dataset.inspectorTab);
      tabs[next].focus();
    });
  }
  function refresh() {
    for (const button of historyButtons) button.disabled = history[button.dataset.history + 'Stack'].length === 0;
    const selection = [state.selectedMemberId, ...state.selectedMemberIds, state.selectedSurfaceId, state.selectedLoadId, state.selectedSupportId].filter(Boolean).join(':');
    document.getElementById('btn-delete-selection').disabled = !selection;
    if (selection !== selectionKey) {
      selectionKey = selection;
      if (selection) showInspector('properties');
    }
    const key = [getLang(), state.currentTool, state.memberDraftType, state.surfaceDraftType,
      state.surfaceDraftMode, state.loadDraftType, state.activeLevelId, state.revision].join(':');
    if (contextKey === key) return;
    contextKey = key;
    const tool = state.currentTool;
    const type = tool === 'member' ? state.memberDraftType : tool === 'surface' ? state.surfaceDraftType : '';
    for (const button of drawButtons) {
      const active = button.dataset.drawTool === tool && (!button.dataset.drawType || button.dataset.drawType === type);
      button.setAttribute('aria-pressed', String(active));
    }
    let guide = 'guideSelect';
    if (tool === 'member') guide = type === 'column' ? 'guideColumn' : 'guideMember';
    if (tool === 'surface') guide = ['wall', 'gableWall'].includes(type) ? 'guideWall'
      : state.surfaceDraftMode === 'polyline' ? 'guidePolyline' : 'guideSurface';
    if (tool === 'load') guide = state.loadDraftType === 'pointLoad' ? 'guidePointLoad' : 'guideLoad';
    if (tool === 'support') guide = 'guideSupport';
    if (tool === 'measure') guide = 'guideMeasure';
    if (tool === 'splitPoint') guide = 'splitAtPointHint';
    const level = state.levels.find(item => item.id === state.activeLevelId);
    document.getElementById('context-level').textContent = level ? level.name + ' / Z = ' + level.z + ' mm' : '';
    document.getElementById('context-tool').textContent = t(type || ({ select: 'selectTool', measure: 'measureTool', splitPoint: 'toolSplitPoint' }[tool] || tool));
    document.getElementById('placement-guide').textContent = t(guide);
    document.getElementById('app-menubar').setAttribute('aria-label', t('mainMenu'));
    document.getElementById('canvas-2d').setAttribute('aria-label', t('planInput'));
    document.querySelector('.inspector-tabs').setAttribute('aria-label', t('modelInfo'));
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
