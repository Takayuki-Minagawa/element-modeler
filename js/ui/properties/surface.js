import { t } from '../../i18n.js';
import { escapeHtml, markInputInvalid, clearInputInvalid } from '../../dom-utils.js';
import { calculateSurfaceUnitWeight } from '../../surface-weight.js';
import { surfaceWeightFeedback, springReferenceLabel } from '../user-def/fields.js';

import { isGableWallSurfaceType, isSlopedSurfaceType, isWallSurfaceType } from '../../domain/model.js';
import { DEFAULT_EAVE_DEPTH_MM, DEFAULT_RAFTER_SPACING_MM, DEFAULT_ROOF_GROUP_ID } from '../../constants.js';
import {
  computeSurfaceWeightAreaM2,
  computeSurfaceWindProjectionM2,
  resolveSurfaceVerticalRange,
} from '../../quantities.js';

// UI delegates to these cohesive behaviors; this is the existing host.
export const surfaceProperties = {
  _renderSurfaceProperties(container) {
    const surface = this.state.getSurface(this.state.selectedSurfaceId);
    if (!surface) {
      container.innerHTML = `<p class="prop-placeholder">${t('noSelection')}</p>`;
      return;
    }

    const isWall = isWallSurfaceType(surface.type);
    const isRoof = surface.type === 'roof';
    const isGableWall = isGableWallSurfaceType(surface.type);
    const isRectangularWall = isWall && !isGableWall;
    const isSloped = isSlopedSurfaceType(surface.type);
    const isWindSurface = isWall || isSloped;
    const canGenerateRoof = (surface.type === 'floor' || surface.type === 'exteriorWall') && surface.shape !== 'line';
    const area = computeSurfaceWeightAreaM2(this.state, surface);
    const vertices = Array.isArray(surface.points) ? surface.points.length : 4;
    const typeLabel = t(surface.type);
    const level = this.state.levels.find(l => l.id === surface.levelId);
    const levelLabel = level ? `${level.name} (z=${level.z})` : surface.levelId;
    const range = resolveSurfaceVerticalRange(this.state, surface);
    const wind = computeSurfaceWindProjectionM2(this.state, surface);
    const sectionDefs = this.state.listSections('surface', surface.type);
    const weightSection = this.state.getSection('surface', surface.type, surface.sectionName);
    const weightMaterial = this.state.getMaterial(weightSection?.material);
    const calculatedWeight = calculateSurfaceUnitWeight(weightSection, weightMaterial);
    const sectionOptions = sectionDefs.length > 0
      ? sectionDefs.map(s =>
        `<option value="${escapeHtml(s.name)}" ${s.name === surface.sectionName ? 'selected' : ''}>${escapeHtml(s.name)}</option>`
      ).join('')
      : `<option value="${escapeHtml(surface.sectionName || '')}" selected>${escapeHtml(surface.sectionName || '-')}</option>`;
    const heightModeOptions = ['full', 'waist', 'hanging', 'custom']
      .map(mode => `<option value="${mode}" ${surface.heightMode === mode ? 'selected' : ''}>${t('wallHeight' + capitalize(mode))}</option>`)
      .join('');
    const windProjectionFields = isWindSurface ? `
      <div class="prop-group">
        <label>${t('calculatedWindArea')}</label>
        <div class="prop-row">
          <div class="prop-group">
            <label>${t('windAreaX')} (m²)</label>
            <input type="text" value="${formatNumber(wind.xAreaM2)}" disabled>
          </div>
          <div class="prop-group">
            <label>${t('windAreaY')} (m²)</label>
            <input type="text" value="${formatNumber(wind.yAreaM2)}" disabled>
          </div>
        </div>
      </div>
    ` : '';
    const roofAutoGenerationFields = canGenerateRoof ? this._surfaceRoofAutoGenHtml() : '';

    container.innerHTML = `
      <div class="prop-group">
        <label>${t('propType')}</label>
        <input type="text" value="${escapeHtml(typeLabel)}" disabled>
      </div>
      <div class="prop-group">
        <label>${t('propLayer')}</label>
        <input type="text" value="${escapeHtml(levelLabel)}" disabled>
      </div>
      <div class="prop-group">
        <label>${t('propSection')}</label>
        <select id="prop-surface-section">${sectionOptions}</select>
        <button type="button" id="prop-apply-draft-surface-section" class="prop-inline-btn" title="${escapeHtml(t('applyAsDraftHint'))}">${escapeHtml(t('applyAsDraft'))}</button>
      </div>
      ${surface.type === 'floor' ? this._surfaceFloorHtml(surface) : ''}
      ${roofAutoGenerationFields}
      ${isRectangularWall ? `
      <div class="prop-group">
        <label>${t('wallHeightMode')}</label>
        <select id="prop-wall-height-mode">${heightModeOptions}</select>
      </div>
      <div class="prop-row">
        <div class="prop-group">
          <label>${t('wallBottomOffset')} (mm)</label>
          <input type="number" id="prop-wall-bottom-offset" value="${Math.round(surface.bottomOffset || 0)}" step="100">
        </div>
        <div class="prop-group">
          <label>${t('wallTopOffset')} (mm)</label>
          <input type="number" id="prop-wall-top-offset" value="${Math.round(surface.topOffset || 0)}" step="100">
        </div>
      </div>
      <div class="prop-group">
        <label>${t('wallVerticalRange')}</label>
        <input type="text" value="${Math.round(range.bottom)} - ${Math.round(range.top)} mm" disabled>
      </div>
      ` : ''}
      ${isGableWall ? this._surfaceGableWallHtml(surface, range) : ''}
      ${isSloped ? this._surfaceSlopedHtml(surface, isRoof) : ''}
      ${windProjectionFields}
      <div class="prop-group">
        <label>${t('propColor')}</label>
        <input type="color" value="${surface.color}" disabled>
      </div>
      <div class="prop-group">
        <label>${t('propArea')}</label>
        <input type="text" value="${formatNumber(area)} m²" disabled>
      </div>
      <div class="prop-group">
        <label>${t('propVertices')}</label>
        <input type="text" value="${vertices}" disabled>
      </div>
      <div class="prop-group">
        <label for="prop-surface-unit-weight">${t('unitWeight')} (${t('weightUnit_surface')})</label>
        <input type="number" id="prop-surface-unit-weight" value="${calculatedWeight ?? surface.unitWeight ?? 0}" min="0" step="any" ${calculatedWeight !== null ? 'readonly' : ''} aria-describedby="prop-surface-weight-note">
      </div>
      <div class="prop-group">
        <label>${t('userDefMaterialName')} / ${t('userDefSurfaceThickness')}</label>
        <input id="prop-surface-weight-material" type="text" value="${escapeHtml(weightSection?.material || t('userDefUnspecified'))} / ${escapeHtml(weightSection?.thickness ?? t('userDefUnspecified'))}" readonly>
      </div>
      <div class="prop-group">
        <label for="prop-surface-additional-weight">${t('userDefAdditionalWeight')}</label>
        <input id="prop-surface-additional-weight" type="text" value="${escapeHtml(weightSection?.additionalWeight ?? t('userDefUnspecified'))}" readonly>
      </div>
      <p id="prop-surface-weight-note" class="quantity-note">${escapeHtml(surfaceWeightFeedback(weightSection, weightMaterial))}</p>
      <div class="prop-group">
        <label for="prop-surface-panel-direction">${t('userDefPanelDirection')}</label>
        <input id="prop-surface-panel-direction" type="text" value="${escapeHtml(weightSection?.panelDirection?.toUpperCase() || t('userDefUnspecified'))}" readonly>
      </div>
      ${[
        ['end-spring', 'userDefPanelEndSpring', weightSection?.endRotationalSpring],
        ['panel-to-panel-spring', 'userDefPanelToPanelSpring', weightSection?.edgeSprings?.panelToPanel],
        ['panel-to-beam-spring', 'userDefPanelToBeamSpring', weightSection?.edgeSprings?.panelToBeam],
      ].map(([id, label, symbol]) => `
      <div class="prop-group">
        <label for="prop-surface-${id}">${t(label)}</label>
        <input id="prop-surface-${id}" type="text" value="${escapeHtml(springReferenceLabel(symbol, this.state.listSprings()))}" readonly>
      </div>`).join('')}
      ${isWindSurface ? `
      <div class="prop-group">
        <label class="prop-check-label">
          <input type="checkbox" id="prop-surface-include-wind" ${surface.includeWind !== false ? 'checked' : ''}>
          <span>${t('includeWind')}</span>
        </label>
      </div>
      ` : ''}
      <div class="prop-group">
        <label class="prop-check-label">
          <input type="checkbox" id="prop-surface-include-seismic" ${surface.includeSeismicWeight ? 'checked' : ''}>
          <span>${t('includeSeismicWeight')}</span>
        </label>
      </div>
    `;

    const bind = (id, key, transform) => this._bindPropInput(id, val => {
      this.state.updateSurface(surface.id, { [key]: val });
      this._notifyPropertyChange(surface.id);
    }, { transform });

    bind('prop-surface-section', 'sectionName');
    const applyDraftSurfaceBtn = document.getElementById('prop-apply-draft-surface-section');
    if (applyDraftSurfaceBtn) {
      applyDraftSurfaceBtn.addEventListener('click', () => {
      return this._runModelChange(() => {
        const current = this.state.getSurface(surface.id);
        if (!current) return;
        this.state.setDraftSectionName('surface', current.type, current.sectionName);
        this.state.surfaceDraftType = current.type;
        const typeSel = document.getElementById('sel-surface-type');
        if (typeSel) typeSel.value = current.type;
        this._updateSurfaceSubOptions();
        this.refreshDraftSectionSelectors();
        this.callbacks.onDraftSectionChange?.();

      });
    });
    }
    bind('prop-surface-top-level', 'topLevelId');
    bind('prop-load-direction', 'loadDirection');
    bind('prop-wall-height-mode', 'heightMode');
    bind('prop-roof-slope', 'roofSlope', (_value, el) => Math.max(0, readNumberInput(el, surface.roofSlope || 0)));
    bind('prop-roof-direction', 'roofDirection');
    bind('prop-roof-base-offset', 'roofBaseOffset', (_value, el) => readNumberInput(el, surface.roofBaseOffset || 0));
    bind('prop-roof-group-id', 'roofGroupId', value => String(value || '').trim() || DEFAULT_ROOF_GROUP_ID);
    const unitWeightInput = document.getElementById('prop-surface-unit-weight');
    if (calculatedWeight === null) unitWeightInput?.addEventListener('change', () => {
      const raw = unitWeightInput.value.trim();
      const value = Number(raw);
      if (unitWeightInput.validity?.badInput || raw === '' || !Number.isFinite(value) || value < 0) {
        markInputInvalid(unitWeightInput, t('userDefInvalidSurfaceTotalWeight'));
        return;
      }
      clearInputInvalid(unitWeightInput);
      this._runModelChange(() => {
        this.state.updateSurface(surface.id, { unitWeight: value });
        this._notifyPropertyChange(surface.id);
      });
    });
    bind('prop-surface-include-wind', 'includeWind');
    bind('prop-surface-include-seismic', 'includeSeismicWeight');

    this._bindRoofGenerationButtons(container, surface);
    this._bindWallOffsetValidation(surface);
    this._bindGableWallOffsets(surface);
  },

  _surfaceFloorHtml(surface) {
    return `
      <div class="prop-group">
        <label>${t('loadDirection')}</label>
        <select id="prop-load-direction">
          <option value="x" ${surface.loadDirection === 'x' ? 'selected' : ''}>X</option>
          <option value="y" ${surface.loadDirection === 'y' ? 'selected' : ''}>Y</option>
          <option value="twoWay" ${surface.loadDirection === 'twoWay' ? 'selected' : ''}>${t('twoWay')}</option>
        </select>
      </div>
    `;
  },

  _surfaceRoofAutoGenHtml() {
    return `
      <div class="prop-group">
        <label>${t('roofAutoGenerate')}</label>
        <select id="prop-auto-roof-pattern">
          <option value="single">${t('roofPatternSingle')}</option>
          <option value="gableX">${t('roofPatternGableX')}</option>
          <option value="gableY">${t('roofPatternGableY')}</option>
          <option value="hip">${t('roofPatternHip')}</option>
        </select>
      </div>
      <div class="prop-row">
        <div class="prop-group">
          <label>${t('roofGroupId')}</label>
          <input type="text" id="prop-auto-roof-group-id" value="${escapeHtml(this.state.surfaceDraftRoofGroupId || DEFAULT_ROOF_GROUP_ID)}">
        </div>
        <div class="prop-group">
          <label>${t('roofSlope')}</label>
          <input type="number" id="prop-auto-roof-slope" value="${this.state.surfaceDraftRoofSlope || 0.3}" min="0" step="0.01">
        </div>
      </div>
      <div class="prop-row">
        <div class="prop-group">
          <label>${t('roofBaseOffset')} (mm)</label>
          <input type="number" id="prop-auto-roof-base-offset" value="${Math.round(this.state.surfaceDraftRoofBaseOffset || 0)}" step="100">
        </div>
        <div class="prop-group">
          <label>${t('roofDirection')}</label>
          <select id="prop-auto-roof-direction">
            <option value="xPlus" ${this.state.surfaceDraftRoofDirection === 'xPlus' ? 'selected' : ''}>${t('roofDirXPlus')}</option>
            <option value="xMinus" ${this.state.surfaceDraftRoofDirection === 'xMinus' ? 'selected' : ''}>${t('roofDirXMinus')}</option>
            <option value="yPlus" ${this.state.surfaceDraftRoofDirection === 'yPlus' ? 'selected' : ''}>${t('roofDirYPlus')}</option>
            <option value="yMinus" ${this.state.surfaceDraftRoofDirection === 'yMinus' ? 'selected' : ''}>${t('roofDirYMinus')}</option>
          </select>
        </div>
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-auto-roof-planes">${t('roofGeneratePlanes')}</button>
      </div>
    `;
  },

  _surfaceGableWallHtml(surface, range) {
    return `
      <div class="prop-group">
        <label>${t('wallBottomOffset')} (mm)</label>
        <input type="number" id="prop-gable-bottom-offset" value="${Math.round(surface.bottomOffset || 0)}" step="100">
      </div>
      <div class="prop-row">
        <div class="prop-group">
          <label>${t('gableStartTopOffset')} (mm)</label>
          <input type="number" id="prop-gable-start-top-offset" value="${Math.round(gableTopOffset(surface, 'gableStartTopOffset'))}" step="100">
        </div>
        <div class="prop-group">
          <label>${t('gableEndTopOffset')} (mm)</label>
          <input type="number" id="prop-gable-end-top-offset" value="${Math.round(gableTopOffset(surface, 'gableEndTopOffset'))}" step="100">
        </div>
      </div>
      <div class="prop-group">
        <label>${t('wallVerticalRange')}</label>
        <input type="text" value="${Math.round(range.bottom)} - ${Math.round(range.top)} mm" disabled>
      </div>
    `;
  },

  _surfaceSlopedHtml(surface, isRoof) {
    return `
      <div class="prop-row">
        <div class="prop-group">
          <label>${t('roofSlope')}</label>
          <input type="number" id="prop-roof-slope" value="${surface.roofSlope || 0}" min="0" step="0.01">
        </div>
        <div class="prop-group">
          <label>${t('roofBaseOffset')} (mm)</label>
          <input type="number" id="prop-roof-base-offset" value="${Math.round(surface.roofBaseOffset || 0)}" step="100">
        </div>
      </div>
      <div class="prop-group">
        <label>${t('roofDirection')}</label>
        <select id="prop-roof-direction">
          <option value="xPlus" ${surface.roofDirection === 'xPlus' ? 'selected' : ''}>${t('roofDirXPlus')}</option>
          <option value="xMinus" ${surface.roofDirection === 'xMinus' ? 'selected' : ''}>${t('roofDirXMinus')}</option>
          <option value="yPlus" ${surface.roofDirection === 'yPlus' ? 'selected' : ''}>${t('roofDirYPlus')}</option>
          <option value="yMinus" ${surface.roofDirection === 'yMinus' ? 'selected' : ''}>${t('roofDirYMinus')}</option>
        </select>
      </div>
      ${isRoof ? `
      <div class="prop-group">
        <label>${t('roofGroupId')}</label>
        <input type="text" id="prop-roof-group-id" value="${escapeHtml(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID)}">
      </div>
      ` : ''}
      ${isRoof ? `
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-edge-members">${t('roofGenerateEdgeMembers')}</button>
      </div>
      <div class="prop-group">
        <label>${t('roofFramingSpacing')} (mm)</label>
        <input type="number" id="prop-roof-framing-spacing" value="${DEFAULT_RAFTER_SPACING_MM}" min="1" step="10">
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-slope-members">${t('roofGenerateSlopeMembers')}</button>
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-joint-members">${t('roofGenerateJointMembers')}</button>
      </div>
      <div class="prop-group">
        <label>${t('roofEaveDepth')} (mm)</label>
        <input type="number" id="prop-roof-eave-depth" value="${DEFAULT_EAVE_DEPTH_MM}" min="1" step="50">
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-eaves">${t('roofGenerateEaves')}</button>
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-gable-walls">${t('roofGenerateGableWalls')}</button>
      </div>
      <div class="prop-group">
        <button type="button" class="support-preset-btn" id="btn-roof-validate-group">${t('roofValidateGroup')}</button>
      </div>
      <div class="prop-row">
        <div class="prop-group">
          <button type="button" class="support-preset-btn" id="btn-roof-remove-generated">${t('roofRemoveGenerated')}</button>
        </div>
        <div class="prop-group">
          <button type="button" class="support-preset-btn" id="btn-roof-regenerate">${t('roofRegenerateGenerated')}</button>
        </div>
      </div>
      ` : ''}
    `;
  },

  _bindRoofGenerationButtons(container, surface) {
    const bindings = [
      ['btn-roof-edge-members', () => {
        const members = this.state.addRoofEdgeMembers(surface.id);
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, members.length, 'roofGeneratedMembers');
      }],
      ['btn-roof-slope-members', () => {
        const spacingEl = document.getElementById('prop-roof-framing-spacing');
        const spacing = Math.max(1, readNumberInput(spacingEl, DEFAULT_RAFTER_SPACING_MM));
        if (spacingEl) spacingEl.value = String(spacing);
        const members = this.state.addRoofSlopeMembers(surface.id, { spacing });
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, members.length, 'roofGeneratedSlopeMembers');
      }],
      ['btn-roof-joint-members', () => {
        const members = this.state.addRoofJointMembers(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID);
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, members.length, 'roofGeneratedJointMembers');
      }],
      ['btn-roof-eaves', () => {
        const depthEl = document.getElementById('prop-roof-eave-depth');
        const depth = Math.max(1, readNumberInput(depthEl, DEFAULT_EAVE_DEPTH_MM));
        if (depthEl) depthEl.value = String(depth);
        const eaves = this.state.addEavesFromRoofGroup(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID, { depth });
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, eaves.length, 'roofGeneratedEaves');
      }],
      ['btn-roof-gable-walls', () => {
        const walls = this.state.addGableWallsFromRoofGroup(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID);
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, walls.length, 'roofGeneratedGableWalls');
      }],
      ['btn-roof-validate-group', () => {
        const result = this.state.validateRoofGroup(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID);
        const message = result.issues.length
          ? t('roofValidationIssues', { n: result.issues.length })
          : t('roofValidationOk');
        this._showInlineNotice(container, message);
      }],
      ['btn-roof-remove-generated', () => {
        const removed = this.state.removeRoofGeneratedElements(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID);
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, removed.total, 'roofRemovedGenerated');
      }],
      ['btn-roof-regenerate', () => {
        const spacingEl = document.getElementById('prop-roof-framing-spacing');
        const depthEl = document.getElementById('prop-roof-eave-depth');
        const spacing = Math.max(1, readNumberInput(spacingEl, DEFAULT_RAFTER_SPACING_MM));
        const depth = Math.max(1, readNumberInput(depthEl, DEFAULT_EAVE_DEPTH_MM));
        if (spacingEl) spacingEl.value = String(spacing);
        if (depthEl) depthEl.value = String(depth);
        const result = this.state.regenerateRoofGeneratedElements(surface.roofGroupId || DEFAULT_ROOF_GROUP_ID, { spacing, depth });
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, result.generatedTotal, 'roofRegeneratedElements');
      }],
      ['btn-auto-roof-planes', () => {
        const groupEl = document.getElementById('prop-auto-roof-group-id');
        const slopeEl = document.getElementById('prop-auto-roof-slope');
        const baseOffsetEl = document.getElementById('prop-auto-roof-base-offset');
        const directionEl = document.getElementById('prop-auto-roof-direction');
        const pattern = document.getElementById('prop-auto-roof-pattern')?.value || 'single';
        const roofGroupId = String(groupEl?.value || '').trim() || DEFAULT_ROOF_GROUP_ID;
        const roofSlope = Math.max(0, readNumberInput(slopeEl, this.state.surfaceDraftRoofSlope || 0.3));
        const roofBaseOffset = readNumberInput(baseOffsetEl, this.state.surfaceDraftRoofBaseOffset || 0);
        const roofDirection = directionEl?.value || this.state.surfaceDraftRoofDirection || 'xPlus';
        if (groupEl) groupEl.value = roofGroupId;
        if (slopeEl) slopeEl.value = String(roofSlope);
        if (baseOffsetEl) baseOffsetEl.value = String(roofBaseOffset);
        this.state.surfaceDraftRoofGroupId = roofGroupId;
        this.state.surfaceDraftRoofSlope = roofSlope;
        this.state.surfaceDraftRoofBaseOffset = roofBaseOffset;
        this.state.surfaceDraftRoofDirection = roofDirection;
        const roofs = this.state.addRoofPlanesFromSurface(surface.id, {
          pattern,
          roofGroupId,
          roofSlope,
          roofBaseOffset,
          roofDirection,
        });
        this._notifyPropertyChange(surface.id);
        this._showGenerationNotice(container, roofs.length, 'roofGeneratedPlanes');
      }],
    ];
    for (const [id, handler] of bindings) {
      document.getElementById(id)?.addEventListener('click', () => this._runModelChange(handler));
    }
  },

  _bindWallOffsetValidation(surface) {
    const bottomEl = document.getElementById('prop-wall-bottom-offset');
    const topEl = document.getElementById('prop-wall-top-offset');
    if (!bottomEl || !topEl) return;
    const apply = () => {
      const bottomOffset = readNumberInput(bottomEl, surface.bottomOffset || 0);
      const topOffset = readNumberInput(topEl, surface.topOffset || 0);
      if (topOffset <= bottomOffset) {
        markInputInvalid(topEl, t('wallInvalidHeight'));
        return;
      }
      clearInputInvalid(bottomEl);
      clearInputInvalid(topEl);
      this.state.updateSurface(surface.id, {
        heightMode: 'custom',
        bottomOffset,
        topOffset,
      });
      this._notifyPropertyChange(surface.id);
    };
    bottomEl.addEventListener('change', () => this._runModelChange(apply));
    topEl.addEventListener('change', () => this._runModelChange(apply));
  },

  _bindGableWallOffsets(surface) {
    const bottomEl = document.getElementById('prop-gable-bottom-offset');
    const startEl = document.getElementById('prop-gable-start-top-offset');
    const endEl = document.getElementById('prop-gable-end-top-offset');
    if (!bottomEl || !startEl || !endEl) return;
    const apply = () => {
      const bottomOffset = readNumberInput(bottomEl, surface.bottomOffset || 0);
      const gableStartTopOffset = readNumberInput(startEl, gableTopOffset(surface, 'gableStartTopOffset'));
      const gableEndTopOffset = readNumberInput(endEl, gableTopOffset(surface, 'gableEndTopOffset'));
      let isValid = true;
      if (gableStartTopOffset < bottomOffset) {
        markInputInvalid(startEl, t('gableInvalidTop'));
        isValid = false;
      } else {
        clearInputInvalid(startEl);
      }
      if (gableEndTopOffset < bottomOffset) {
        markInputInvalid(endEl, t('gableInvalidTop'));
        isValid = false;
      } else {
        clearInputInvalid(endEl);
      }
      if (!isValid) return;
      clearInputInvalid(bottomEl);
      this.state.updateSurface(surface.id, {
        heightMode: 'custom',
        bottomOffset,
        gableStartTopOffset,
        gableEndTopOffset,
      });
      this._notifyPropertyChange(surface.id);
    };
    bottomEl.addEventListener('change', () => this._runModelChange(apply));
    startEl.addEventListener('change', () => this._runModelChange(apply));
    endEl.addEventListener('change', () => this._runModelChange(apply));
  },

  _showInlineNotice(container, message) {
    const notice = document.createElement('p');
    notice.className = 'quantity-note';
    notice.textContent = message;
    container.appendChild(notice);
  },

  _showGenerationNotice(container, count, messageKey) {
    const message = count > 0
      ? t(messageKey, { n: count })
      : t('roofGeneratedNone');
    this._showInlineNotice(container, message);
  }
};

function formatNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  if (n === 0) return '0';
  if (Math.abs(n) >= 100) return n.toFixed(0);
  if (Math.abs(n) >= 10) return n.toFixed(1);
  return n.toFixed(2);
}

function capitalize(value) {
  const text = String(value || '');
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

function readNumberInput(input, fallback) {
  const n = Number(input?.value);
  return Number.isFinite(n) ? n : fallback;
}

function gableTopOffset(surface, key) {
  return finiteValue(surface?.[key], surface?.topOffset);
}

function finiteValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    const fallbackNumber = Number(fallback);
    return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
  }
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const fallbackNumber = Number(fallback);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
}
