import { executeModelMutation } from './commands/model-command.js';
import { renderDiagnostics } from './ui/diagnostics.js';
import { memberProperties } from './ui/properties/member.js';
import { surfaceProperties } from './ui/properties/surface.js';
import { loadProperties } from './ui/properties/load.js';
import { supportProperties } from './ui/properties/support.js';
// ui.js - UI controls (toolbar, property panel, status bar)

import { t, getLang } from './i18n.js';
import { escapeHtml, markInputInvalid, clearInputInvalid } from './dom-utils.js';
import { roofRoleLabelKey } from './element-style.js';
import { isSlopedSurfaceType, isWallSurfaceType, normalizeGridSize } from './state.js';
import { DEFAULT_ROOF_GROUP_ID, ZOOM_PERCENT_FACTOR } from './constants.js';
import {
  computeMemberLengthM,
  computeQuantitySummary,
  computeSurfaceSeismicWeightN,
  computeSurfaceWindProjectionM2,
} from './quantities.js';

export class UI {
  constructor(state, callbacks) {
    this.state = state;
    this.callbacks = callbacks;
    this._quantitySummaryLastKey = null;

    this._setupToolbar();
    this.refreshLevelSelectors();
  }

  _setupToolbar() {
    // Tool selector combobox
    document.getElementById('sel-tool').addEventListener('change', e => {
      this.state.currentTool = e.target.value;
      this._updateToolUI();
      this.callbacks.onToolChange?.(this.state.currentTool);
    });

    // Snap toggle
    document.getElementById('chk-snap').addEventListener('change', e => {
      this.state.updateSetting('snap', e.target.checked);
      this.updateStatusBar();
      this.callbacks.onSnapToggle?.(e.target.checked);
    });

    // Show supports toggle
    document.getElementById('chk-show-supports').addEventListener('change', e => {
      this.state.updateSetting('showSupports', e.target.checked);
      this.callbacks.onPropertyChange?.();
    });

    // Wide pick toggle
    document.getElementById('chk-wide-pick').addEventListener('change', e => {
      this.state.updateSetting('widePick', e.target.checked);
    });

    document.getElementById('sel-plan-layer-display-mode').addEventListener('change', e => {
      this.state.updateSetting('planLayerDisplayMode', e.target.value);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('chk-plan-layer-selection-lock').addEventListener('change', e => {
      this.state.updateSetting('planLayerSelectionLock', e.target.checked);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('sel-3d-layer-display-mode').addEventListener('change', e => {
      this.state.updateSetting('view3dLayerDisplayMode', e.target.value);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('sel-member-3d-render-mode').addEventListener('change', e => {
      this.state.updateSetting('member3dRenderMode', e.target.value);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('sel-beam-3d-section-mode').addEventListener('change', e => {
      this.state.updateSetting('beam3dSectionMode', e.target.value);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('sel-display-preset').addEventListener('change', e => {
      this.state.applyDisplayPreset(e.target.value);
      this.refreshLevelSelectors();
      this.callbacks.onPropertyChange?.();
    });

    const bindDisplayCheckbox = (id, key) => {
      document.getElementById(id).addEventListener('change', e => {
        this.state.updateSetting(key, e.target.checked);
        this.callbacks.onPropertyChange?.();
      });
    };
    bindDisplayCheckbox('chk-show-members', 'showMembers');
    bindDisplayCheckbox('chk-show-surfaces', 'showSurfaces');
    bindDisplayCheckbox('chk-show-loads', 'showLoads');
    bindDisplayCheckbox('chk-show-member-end-symbols', 'showMemberEndSymbols');
    bindDisplayCheckbox('chk-show-placement-labels', 'showPlacementLabels');

    document.getElementById('sel-member-type-filter').addEventListener('change', e => {
      this.state.updateSetting('memberTypeFilter', e.target.value);
      this.callbacks.onPropertyChange?.();
    });
    document.getElementById('sel-section-filter').addEventListener('change', e => {
      this.state.updateSetting('sectionFilter', e.target.value);
      this.callbacks.onPropertyChange?.();
    });

    document.getElementById('btn-copy-level').addEventListener('click', () => {
      this.callbacks.onCopyLevel?.(
        document.getElementById('sel-copy-source-layer').value,
        document.getElementById('sel-copy-target-layer').value
      );
    });

    document.getElementById('btn-model-check').addEventListener('click', () => {
      this.renderModelCheck();
      this.callbacks.onModelCheck?.();
    });

    // Grid size (integer mm, clamped to allowed range)
    document.getElementById('sel-grid').addEventListener('change', e => {
      const gridSize = normalizeGridSize(e.target.value);
      this.state.updateSetting('gridSize', gridSize);
      e.target.value = String(gridSize);
      this.callbacks.onGridChange?.(gridSize);
    });

    // Active layer
    document.getElementById('sel-active-layer').addEventListener('change', e => {
      this.state.activeLevelId = e.target.value;
      this._syncWallHeightInputs(false);
      this._updateMemberLayerHint();
      this.callbacks.onLayerChange?.(this.state.activeLevelId);
    });

    // Member default type
    document.getElementById('sel-member-type').addEventListener('change', e => {
      this.state.memberDraftType = e.target.value;
      this._updateMemberLayerHint();
      this.refreshDraftSectionSelectors();
    });

    // Sticky ("paste") draft section for new members
    document.getElementById('sel-member-section')?.addEventListener('change', e => {
      this.state.setDraftSectionName('member', this.state.memberDraftType, e.target.value);
      this.refreshDraftSectionSelectors();
    });

    // Surface defaults
    document.getElementById('sel-surface-type').addEventListener('change', e => {
      this.state.surfaceDraftType = e.target.value;
      this._updateSurfaceSubOptions();
      this.refreshDraftSectionSelectors();
    });

    // Sticky ("paste") draft section for new surfaces
    document.getElementById('sel-surface-section')?.addEventListener('change', e => {
      this.state.setDraftSectionName('surface', this.state.surfaceDraftType, e.target.value);
      this.refreshDraftSectionSelectors();
    });
    document.getElementById('sel-surface-mode').addEventListener('change', e => {
      this.state.surfaceDraftMode = e.target.value;
    });
    document.getElementById('sel-load-direction').addEventListener('change', e => {
      this.state.surfaceDraftLoadDir = e.target.value;
    });
    document.getElementById('sel-top-layer').addEventListener('change', e => {
      this.state.surfaceDraftTopLevelId = e.target.value;
    });
    document.getElementById('sel-wall-height-mode').addEventListener('change', e => {
      this.state.surfaceDraftHeightMode = e.target.value;
      this._syncWallHeightInputs(true);
    });
    const onWallOffsetChange = () => {
      const bottomEl = document.getElementById('input-wall-bottom-offset');
      const topEl = document.getElementById('input-wall-top-offset');
      const bottomOffset = readNumberInput(bottomEl, this.state.surfaceDraftBottomOffset || 0);
      const topOffset = readNumberInput(topEl, this.state.surfaceDraftTopOffset || 1200);
      if (topOffset <= bottomOffset) {
        markInputInvalid(topEl, t('wallInvalidHeight'));
        return;
      }
      clearInputInvalid(bottomEl);
      clearInputInvalid(topEl);
      this.state.surfaceDraftHeightMode = 'custom';
      this.state.surfaceDraftBottomOffset = bottomOffset;
      this.state.surfaceDraftTopOffset = topOffset;
      this._syncWallHeightInputs(false);
    };
    document.getElementById('input-wall-bottom-offset').addEventListener('change', onWallOffsetChange);
    document.getElementById('input-wall-top-offset').addEventListener('change', onWallOffsetChange);
    document.getElementById('input-roof-slope').addEventListener('change', e => {
      this.state.surfaceDraftRoofSlope = Math.max(0, readNumberInput(e.target, this.state.surfaceDraftRoofSlope || 0));
      e.target.value = String(this.state.surfaceDraftRoofSlope);
    });
    document.getElementById('sel-roof-direction').addEventListener('change', e => {
      this.state.surfaceDraftRoofDirection = e.target.value;
    });
    document.getElementById('input-roof-base-offset').addEventListener('change', e => {
      this.state.surfaceDraftRoofBaseOffset = readNumberInput(e.target, this.state.surfaceDraftRoofBaseOffset || 0);
      e.target.value = String(this.state.surfaceDraftRoofBaseOffset);
    });
    document.getElementById('input-roof-group-id').addEventListener('change', e => {
      this.state.surfaceDraftRoofGroupId = String(e.target.value || '').trim() || DEFAULT_ROOF_GROUP_ID;
      e.target.value = this.state.surfaceDraftRoofGroupId;
    });

    // Load type
    document.getElementById('sel-load-type').addEventListener('change', e => {
      this.state.loadDraftType = e.target.value;
    });

    // Load case for newly placed loads
    document.getElementById('sel-load-case')?.addEventListener('change', e => {
      this.state.loadDraftCase = e.target.value;
    });

    // Keyboard shortcuts for tools
    window.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
      if (e.key === 'v' || e.key === 'V') {
        this.state.currentTool = 'select';
      } else if (e.key === 'm' || e.key === 'M') {
        this.state.currentTool = 'member';
      } else if (e.key === 'f' || e.key === 'F') {
        this.state.currentTool = 'surface';
      } else if (e.key === 'l' || e.key === 'L') {
        this.state.currentTool = 'load';
      } else if (e.key === 's' || e.key === 'S') {
        this.state.currentTool = 'support';
      } else if (e.key === 'd' || e.key === 'D') {
        this.state.currentTool = 'measure';
      } else {
        return;
      }
      this._updateToolUI();
      this.callbacks.onToolChange?.(this.state.currentTool);
    });

    // Initial tool options visibility
    this._updateToolOptions();
  }

  _updateToolUI() {
    const selTool = document.getElementById('sel-tool');
    // splitPoint is a temporary canvas interaction rather than a toolbar
    // option; keep the previous visible option instead of blanking the select.
    if (selTool && this.state.currentTool !== 'splitPoint') {
      selTool.value = this.state.currentTool;
    }

    const toolStatus = document.getElementById('status-tool');
    if (toolStatus) {
      const statusKeys = {
        select: 'toolSelect',
        member: 'toolMember',
        surface: 'toolSurface',
        load: 'toolLoad',
        support: 'toolSupport',
        measure: 'toolMeasure',
        splitPoint: 'toolSplitPoint',
      };
      toolStatus.textContent = t(statusKeys[this.state.currentTool] || 'toolSelect');
    }

    this._updateToolOptions();
  }

  // Temporary canvas modes (currently beam split-point selection) are owned
  // by ToolManager rather than the toolbar, so they use this small public
  // hook to keep the selector and status text in sync.
  refreshToolState() {
    this._updateToolUI();
  }

  _updateToolOptions() {
    const tool = this.state.currentTool;
    const memberOpts = document.getElementById('tool-opts-member');
    const surfaceOpts = document.getElementById('tool-opts-surface');
    const loadOpts = document.getElementById('tool-opts-load');
    if (memberOpts) memberOpts.classList.toggle('visible', tool === 'member');
    if (surfaceOpts) surfaceOpts.classList.toggle('visible', tool === 'surface');
    if (loadOpts) loadOpts.classList.toggle('visible', tool === 'load');
    // Support tool has no sub-options
    this._updateSurfaceSubOptions();
  }

  _updateSurfaceSubOptions() {
    const type = this.state.surfaceDraftType;
    const isFloor = type === 'floor';
    const isWall = isWallSurfaceType(type);
    const isRoof = type === 'roof';
    const isSloped = isSlopedSurfaceType(type);
    const modeLabel = document.getElementById('label-surface-mode');
    const loadDirLabel = document.getElementById('label-load-direction');
    const topLayerLabel = document.getElementById('label-top-layer');
    const wallHeightLabel = document.getElementById('label-wall-height-mode');
    const wallBottomLabel = document.getElementById('label-wall-bottom-offset');
    const wallTopLabel = document.getElementById('label-wall-top-offset');
    const roofSlopeLabel = document.getElementById('label-roof-slope');
    const roofDirectionLabel = document.getElementById('label-roof-direction');
    const roofBaseOffsetLabel = document.getElementById('label-roof-base-offset');
    const roofGroupLabel = document.getElementById('label-roof-group-id');
    if (modeLabel) modeLabel.style.display = (isFloor || isSloped) ? '' : 'none';
    if (loadDirLabel) loadDirLabel.style.display = isFloor ? '' : 'none';
    if (topLayerLabel) topLayerLabel.style.display = 'none';
    if (wallHeightLabel) wallHeightLabel.style.display = isWall ? '' : 'none';
    if (wallBottomLabel) wallBottomLabel.style.display = isWall ? '' : 'none';
    if (wallTopLabel) wallTopLabel.style.display = isWall ? '' : 'none';
    if (roofSlopeLabel) roofSlopeLabel.style.display = isSloped ? '' : 'none';
    if (roofDirectionLabel) roofDirectionLabel.style.display = isSloped ? '' : 'none';
    if (roofBaseOffsetLabel) roofBaseOffsetLabel.style.display = isSloped ? '' : 'none';
    if (roofGroupLabel) roofGroupLabel.style.display = isRoof ? '' : 'none';
    this._syncWallHeightInputs(false);
    this._syncRoofInputs();
  }

  _syncWallHeightInputs(applyPreset) {
    const modeEl = document.getElementById('sel-wall-height-mode');
    const bottomEl = document.getElementById('input-wall-bottom-offset');
    const topEl = document.getElementById('input-wall-top-offset');
    if (!modeEl || !bottomEl || !topEl) return;

    const mode = this.state.surfaceDraftHeightMode || 'full';
    modeEl.value = mode;

    if (applyPreset || mode !== 'custom') {
      const topLevelId = this.state.getNextLevelId(this.state.activeLevelId);
      const offsets = this.state.getSurfaceHeightOffsets({
        heightMode: mode,
        levelId: this.state.activeLevelId,
        topLevelId,
        bottomOffset: this.state.surfaceDraftBottomOffset,
        topOffset: this.state.surfaceDraftTopOffset,
      });
      this.state.surfaceDraftBottomOffset = offsets.bottomOffset;
      this.state.surfaceDraftTopOffset = offsets.topOffset;
    }

    bottomEl.value = String(Math.round(this.state.surfaceDraftBottomOffset || 0));
    topEl.value = String(Math.round(this.state.surfaceDraftTopOffset || 0));
    const isCustom = mode === 'custom';
    bottomEl.disabled = !isCustom;
    topEl.disabled = !isCustom;
  }

  _syncRoofInputs() {
    const slopeEl = document.getElementById('input-roof-slope');
    const directionEl = document.getElementById('sel-roof-direction');
    const baseOffsetEl = document.getElementById('input-roof-base-offset');
    const groupEl = document.getElementById('input-roof-group-id');
    if (slopeEl) slopeEl.value = String(this.state.surfaceDraftRoofSlope || 0);
    if (directionEl) directionEl.value = this.state.surfaceDraftRoofDirection || 'xPlus';
    if (baseOffsetEl) baseOffsetEl.value = String(this.state.surfaceDraftRoofBaseOffset || 0);
    if (groupEl) groupEl.value = this.state.surfaceDraftRoofGroupId || DEFAULT_ROOF_GROUP_ID;
  }

  refreshLevelSelectors() {
    const sortedLevels = [...this.state.levels].sort((a, b) => a.z - b.z);
    const layerHtml = sortedLevels
      .map(l => `<option value="${l.id}">${l.name} (z=${l.z})</option>`)
      .join('');

    const selActive = document.getElementById('sel-active-layer');
    const selTop = document.getElementById('sel-top-layer');
    if (selActive) {
      selActive.innerHTML = layerHtml;
      selActive.value = this.state.activeLevelId;
    }
    if (selTop) {
      selTop.innerHTML = layerHtml;
      selTop.value = this.state.surfaceDraftTopLevelId;
    }
    const selMemberType = document.getElementById('sel-member-type');
    if (selMemberType) selMemberType.value = this.state.memberDraftType;
    const selSurfaceType = document.getElementById('sel-surface-type');
    if (selSurfaceType) selSurfaceType.value = this.state.surfaceDraftType;
    const selSurfaceMode = document.getElementById('sel-surface-mode');
    if (selSurfaceMode) selSurfaceMode.value = this.state.surfaceDraftMode;
    const selLoadDir = document.getElementById('sel-load-direction');
    if (selLoadDir) selLoadDir.value = this.state.surfaceDraftLoadDir;
    const selLoadCase = document.getElementById('sel-load-case');
    if (selLoadCase) selLoadCase.value = this.state.loadDraftCase || 'DL';
    const selPlanLayerMode = document.getElementById('sel-plan-layer-display-mode');
    if (selPlanLayerMode) selPlanLayerMode.value = this.state.settings.planLayerDisplayMode || 'all';
    const chkSelectionLock = document.getElementById('chk-plan-layer-selection-lock');
    if (chkSelectionLock) chkSelectionLock.checked = !!this.state.settings.planLayerSelectionLock;
    const sel3DLayerMode = document.getElementById('sel-3d-layer-display-mode');
    if (sel3DLayerMode) sel3DLayerMode.value = this.state.settings.view3dLayerDisplayMode || 'all';
    const selMember3DMode = document.getElementById('sel-member-3d-render-mode');
    if (selMember3DMode) selMember3DMode.value = this.state.settings.member3dRenderMode || 'solid';
    const selBeam3DSectionMode = document.getElementById('sel-beam-3d-section-mode');
    if (selBeam3DSectionMode) selBeam3DSectionMode.value = this.state.settings.beam3dSectionMode || 'box';
    const selPreset = document.getElementById('sel-display-preset');
    if (selPreset) selPreset.value = this.state.settings.displayPreset || 'input';
    this._refreshDisplayFilters();
    this._refreshCopyLayerSelectors(layerHtml);
    this._updateMemberLayerHint();
    this._syncWallHeightInputs(false);
    this._syncRoofInputs();
    this.refreshDraftSectionSelectors();
  }

  // Populates the sticky ("paste") section dropdowns so the currently retained
  // section for each draft type stays visible and selectable.
  refreshDraftSectionSelectors() {
    const fill = (selectId, target, type) => {
      const sel = document.getElementById(selectId);
      if (!sel) return;
      const sections = this.state.listSections(target, type);
      const current = this.state.getDraftSectionName(target, type);
      sel.innerHTML = sections.length
        ? sections.map(s =>
          `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`
        ).join('')
        : `<option value="">-</option>`;
      if (current && sections.some(s => s.name === current)) sel.value = current;
    };
    fill('sel-member-section', 'member', this.state.memberDraftType || 'beam');
    fill('sel-surface-section', 'surface', this.state.surfaceDraftType || 'floor');
  }

  _refreshCopyLayerSelectors(layerHtml) {
    const source = document.getElementById('sel-copy-source-layer');
    const target = document.getElementById('sel-copy-target-layer');
    if (source) {
      source.innerHTML = layerHtml;
      source.value = this.state.activeLevelId;
    }
    if (target) {
      target.innerHTML = layerHtml;
      target.value = this.state.getNextLevelId(this.state.activeLevelId) || this.state.activeLevelId;
    }
  }

  _refreshDisplayFilters() {
    const setChecked = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.checked = value;
    };
    setChecked('chk-show-members', this.state.settings.showMembers !== false);
    setChecked('chk-show-surfaces', this.state.settings.showSurfaces !== false);
    setChecked('chk-show-loads', this.state.settings.showLoads !== false);
    setChecked('chk-show-member-end-symbols', !!this.state.settings.showMemberEndSymbols);
    setChecked('chk-show-placement-labels', this.state.settings.showPlacementLabels !== false);
    const typeFilter = document.getElementById('sel-member-type-filter');
    if (typeFilter) typeFilter.value = this.state.settings.memberTypeFilter || 'all';
    const sectionFilter = document.getElementById('sel-section-filter');
    if (sectionFilter) {
      const selected = this.state.settings.sectionFilter || 'all';
      const memberSections = this.state.sectionCatalog
        .filter(s => s.target === 'member')
        .sort((a, b) => a.name.localeCompare(b.name));
      sectionFilter.innerHTML = [
        `<option value="all">${escapeHtml(t('filterAll'))}</option>`,
        ...memberSections.map(s =>
          `<option value="${escapeHtml(s.name)}">${escapeHtml(s.name)}</option>`
        ),
      ].join('');
      const resolved = memberSections.some(s => s.name === selected) ? selected : 'all';
      sectionFilter.value = resolved;
      this.state.updateSetting('sectionFilter', resolved);
    }
  }

  renderModelCheck() {
    this._diagnosticSource = 'model';
    renderDiagnostics(this, this.state.validateModel());
  }

  renderAnalysisPreflight(preflight) {
    this._diagnosticSource = 'preflight';
    this._diagnosticPreflight = preflight;
    const summary = preflight.summary;
    renderDiagnostics(this, preflight.issues, '<p class="quantity-note">' +
      escapeHtml(t('analysisPreflightSummary', summary)) + '</p>');
  }

  setDiagnosticFilters(filters = {}) {
    this._diagnosticFilters = { ...(this._diagnosticFilters || { severity: 'all', elementType: 'all' }), ...filters };
    renderDiagnostics(this, this._diagnosticIssues || [], this._diagnosticSummaryHtml || '');
    this.callbacks.onDiagnosticFilterChange?.({ ...this._diagnosticFilters });
  }

  _runModelChange(mutate) {
    if (this._modelCommandActive) return mutate();
    this._modelCommandActive = true;
    const effects = this._modelCommandEffects = [];
    let outcome;
    try {
      outcome = this.callbacks.onModelCommand
        ? this.callbacks.onModelCommand(mutate)
        : executeModelMutation(this.state, mutate);
    } finally {
      this._modelCommandActive = false;
      this._modelCommandEffects = null;
    }
    // History and normalized no-op revisions must be settled before the parent
    // updates renderers, quantities or cached controls. Failed commands discard
    // their effects; nested handlers share the outer command's ordered queue.
    for (const effect of effects) effect();
    return outcome;
  }

  _afterModelChange(effect) {
    if (this._modelCommandActive) {
      this._modelCommandEffects.push(effect);
      return;
    }
    return effect();
  }

  _notifyPropertyChange(...args) {
    return this._afterModelChange(() => this.callbacks.onPropertyChange?.(...args));
  }

  _updateMemberLayerHint() {
    const hint = document.getElementById('member-layer-hint');
    if (!hint) return;
    const activeLevel = this.state.levels.find(l => l.id === this.state.activeLevelId);
    const topLevelId = this.state.getNextLevelId(this.state.activeLevelId);
    const topLevel = this.state.levels.find(l => l.id === topLevelId);
    const activeLabel = activeLevel ? `${activeLevel.name} (z=${activeLevel.z})` : (this.state.activeLevelId || '-');
    const topLabel = topLevel ? `${topLevel.name} (z=${topLevel.z})` : '-';

    if (this.state.memberDraftType === 'column') {
      hint.textContent = t('memberLayerHintColumn', { base: activeLabel, top: topLabel });
    } else if (this.state.memberDraftType === 'vbrace') {
      hint.textContent = t('memberLayerHintVBrace', { base: activeLabel, top: topLabel });
    } else {
      hint.textContent = t('memberLayerHintPlan', { layer: activeLabel });
    }
  }

  updatePropertyPanel() {
    this.refreshQuantitySummary();
    const key = JSON.stringify([this.state.revision, getLang(), this.state.activeLevelId,
      this.state.selectedNodeId, this.state.selectedMemberId, this.state.selectedMemberIds,
      this.state.selectedSurfaceId, this.state.selectedLoadId, this.state.selectedSupportId]);
    if (this._propertyPanelState === this.state && this._propertyPanelKey === key) return;
    this._propertyPanelState = this.state;
    this._propertyPanelKey = key;
    const container = document.getElementById('prop-content');

    if (this.state.selectedSupportId) {
      this._renderSupportProperties(container);
      return;
    }

    if (this.state.selectedLoadId) {
      this._renderLoadProperties(container);
      return;
    }

    if (this.state.selectedSurfaceId) {
      this._renderSurfaceProperties(container);
      return;
    }

    if (this.state.selectedMemberIds.length > 1) {
      this._renderMultiMemberProperties(container);
      return;
    }

    const member = this.state.selectedMemberId
      ? this.state.getMember(this.state.selectedMemberId)
      : null;

    if (!member) {
      container.innerHTML = `<p class="prop-placeholder">${t('noSelection')}</p><p class="empty-selection-guide">${t('selectionGuide')}</p>`;
      return;
    }

    this._renderMemberProperties(container, member);
  }

  // Batch panel shown when 2+ members are selected: summary, batch section
  // change and the copy/transform operations (mirror / rotate / array).
  _renderMultiMemberProperties(...args) {
    return memberProperties._renderMultiMemberProperties.apply(this, args);
  }

  // Shared property-input binder used by every _renderXxxProperties method.
  // applyFn receives the (optionally transformed) input value and performs the
  // state mutation. Checkboxes are detected automatically or via the checkbox
  // option; transform additionally receives the element for advanced parsing.
  _bindPropInput(id, applyFn, { transform = v => v, checkbox = false } = {}) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      const raw = (checkbox || el.type === 'checkbox') ? el.checked : el.value;
      this._runModelChange(() => applyFn(transform(raw, el)));
    });
  }

  _renderMemberProperties(...args) {
    return memberProperties._renderMemberProperties.apply(this, args);
  }

  _renderSurfaceProperties(...args) {
    return surfaceProperties._renderSurfaceProperties.apply(this, args);
  }

  // Per-type surface HTML fragments. Kept as pure string builders so the
  // orchestrator above stays readable; the rectangular-wall block and the
  // calculated wind fields remain inline there because they gate shared layout.
  _surfaceFloorHtml(...args) {
    return surfaceProperties._surfaceFloorHtml.apply(this, args);
  }

  _surfaceRoofAutoGenHtml(...args) {
    return surfaceProperties._surfaceRoofAutoGenHtml.apply(this, args);
  }

  _surfaceGableWallHtml(...args) {
    return surfaceProperties._surfaceGableWallHtml.apply(this, args);
  }

  _surfaceSlopedHtml(...args) {
    return surfaceProperties._surfaceSlopedHtml.apply(this, args);
  }

  // Table-driven binder for the roof auto-generation buttons: each entry maps a
  // button element id to the click handler that drives the matching state method.
  _bindRoofGenerationButtons(...args) {
    return surfaceProperties._bindRoofGenerationButtons.apply(this, args);
  }

  _bindWallOffsetValidation(...args) {
    return surfaceProperties._bindWallOffsetValidation.apply(this, args);
  }

  _bindGableWallOffsets(...args) {
    return surfaceProperties._bindGableWallOffsets.apply(this, args);
  }

  _showInlineNotice(...args) {
    // A parent property notification can replace the panel contents first.
    return this._afterModelChange(() => surfaceProperties._showInlineNotice.apply(this, args));
  }

  _showGenerationNotice(...args) {
    return surfaceProperties._showGenerationNotice.apply(this, args);
  }

  _renderLoadProperties(...args) {
    return loadProperties._renderLoadProperties.apply(this, args);
  }

  _renderSupportProperties(...args) {
    return supportProperties._renderSupportProperties.apply(this, args);
  }

  refreshQuantitySummary({ force = false } = {}) {
    // Lightweight change signature: the model revision bumps on every mutating
    // state method (including load/undo/redo), and the display language changes
    // the rendered labels. This avoids stringifying the whole model each call.
    const key = `${this.state.revision}|${getLang()}`;
    if (!force && key === this._quantitySummaryLastKey) return;
    this._quantitySummaryLastKey = key;
    this._renderQuantitySummary();
  }

  _renderQuantitySummary() {
    const container = document.getElementById('quantity-content');
    if (!container) return;
    const summary = computeQuantitySummary(this.state);
    const hasSkippedWeightSurfaces = (this.state.surfaces || []).some(surface =>
      surface.includeSeismicWeight && !(Number(surface.unitWeight) > 0)
    );
    const rows = summary.levels
      .filter(row => row.windXAreaM2 || row.windYAreaM2 || row.seismicWeightN)
      .map(row => `
        <tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${formatNumber(row.windXAreaM2)}</td>
          <td>${formatNumber(row.windYAreaM2)}</td>
          <td>${formatNumber(row.seismicWeightN)}</td>
        </tr>
      `).join('');
    const roofMemberRows = summary.roofMembers.rows
      .map(row => `
        <tr>
          <td>${escapeHtml(t(roofRoleLabelKey(row.roofRole)))}</td>
          <td>${row.count}</td>
          <td>${formatNumber(row.lengthM)}</td>
        </tr>
      `).join('');
    const surfaceDetailRows = (this.state.surfaces || [])
      .map(surface => {
        const wind = surface.includeWind !== false
          ? computeSurfaceWindProjectionM2(this.state, surface)
          : { xAreaM2: 0, yAreaM2: 0 };
        const seismicWeight = surface.includeSeismicWeight
          ? computeSurfaceSeismicWeightN(this.state, surface)
          : 0;
        return `
          <tr>
            <td>${escapeHtml(surface.id || '-')}</td>
            <td>${escapeHtml(t(surface.type))}</td>
            <td>${escapeHtml(surface.levelId || '-')}</td>
            <td>${formatNumber(wind.xAreaM2)}</td>
            <td>${formatNumber(wind.yAreaM2)}</td>
            <td>${formatNumber(seismicWeight)}</td>
          </tr>
        `;
      }).join('');
    const roofMemberDetailRows = (this.state.members || [])
      .filter(member => member.roofRole)
      .map(member => `
        <tr>
          <td>${escapeHtml(member.id || '-')}</td>
          <td>${escapeHtml(t(roofRoleLabelKey(member.roofRole)))}</td>
          <td>${escapeHtml(member.levelId || '-')}</td>
          <td>${formatNumber(computeMemberLengthM(this.state, member))}</td>
        </tr>
      `).join('');

    container.innerHTML = `
      <table class="quantity-table">
        <thead>
          <tr>
            <th>${t('quantityLevel')}</th>
            <th>${t('windAreaX')}</th>
            <th>${t('windAreaY')}</th>
            <th>${t('quantitySeismicWeight')}</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `
          <tr>
            <td>-</td>
            <td>0</td>
            <td>0</td>
            <td>0</td>
          </tr>`}
          <tr>
            <th>${t('quantityTotal')}</th>
            <th>${formatNumber(summary.totals.windXAreaM2)}</th>
            <th>${formatNumber(summary.totals.windYAreaM2)}</th>
            <th>${formatNumber(summary.totals.seismicWeightN)}</th>
          </tr>
        </tbody>
      </table>
      ${roofMemberRows ? `
      <h3 class="quantity-subtitle">${t('quantityRoofMembers')}</h3>
      <table class="quantity-table">
        <thead>
          <tr>
            <th>${t('quantityRoofRole')}</th>
            <th>${t('quantityMemberCount')}</th>
            <th>${t('quantityMemberLength')}</th>
          </tr>
        </thead>
        <tbody>
          ${roofMemberRows}
          <tr>
            <th>${t('quantityTotal')}</th>
            <th>${summary.roofMembers.totals.count}</th>
            <th>${formatNumber(summary.roofMembers.totals.lengthM)}</th>
          </tr>
        </tbody>
      </table>
      ` : ''}
      <details class="quantity-detail">
        <summary>${t('quantitySurfaceDetails')}</summary>
        <div class="quantity-detail-scroll">
          <table class="quantity-table quantity-detail-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>${t('propType')}</th>
                <th>${t('quantityLevel')}</th>
                <th>${t('windAreaX')}</th>
                <th>${t('windAreaY')}</th>
                <th>${t('quantitySeismicWeight')}</th>
              </tr>
            </thead>
            <tbody>
              ${surfaceDetailRows || `
              <tr>
                <td>-</td><td>-</td><td>-</td><td>0</td><td>0</td><td>0</td>
              </tr>`}
            </tbody>
          </table>
        </div>
      </details>
      <details class="quantity-detail">
        <summary>${t('quantityRoofMemberDetails')}</summary>
        <div class="quantity-detail-scroll">
          <table class="quantity-table quantity-detail-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>${t('quantityRoofRole')}</th>
                <th>${t('quantityLevel')}</th>
                <th>${t('quantityMemberLength')}</th>
              </tr>
            </thead>
            <tbody>
              ${roofMemberDetailRows || `
              <tr>
                <td>-</td><td>-</td><td>-</td><td>0</td>
              </tr>`}
            </tbody>
          </table>
        </div>
      </details>
      ${hasSkippedWeightSurfaces ? `<p class="quantity-note">${t('quantityNoWeight')}</p>` : ''}
    `;
  }

  updateStatusBar() {
    const snap = document.getElementById('status-snap');
    if (snap) snap.textContent = this.state.settings.snap ? t('snapOn') : t('snapOff');
  }

  updateZoom(scale) {
    const el = document.getElementById('status-zoom');
    if (el) el.textContent = `Zoom: ${Math.round(scale * ZOOM_PERCENT_FACTOR)}%`;
  }

  applyLanguage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.textContent = t(key);
    });
    this.refreshLevelSelectors();
    this._updateToolUI();
    this.callbacks.onPropertyChange?.();
    this.updateStatusBar();
    this.refreshQuantitySummary({ force: true });
    this.updatePropertyPanel();
    if (this._diagnosticSource === 'model') this.renderModelCheck();
    else if (this._diagnosticSource === 'preflight') this.renderAnalysisPreflight(this._diagnosticPreflight);
  }
}

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function readNumberInput(input, fallback) {
  const n = Number(input?.value);
  return Number.isFinite(n) ? n : fallback;
}
