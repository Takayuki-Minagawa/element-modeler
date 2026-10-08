// analysis-settings-modal.js - Edits persistent mass-source and self-weight
// metadata used by analysis JSON/CSV exports.

import { LOAD_CASES } from './constants.js';
import { clearInputInvalid, escapeHtml, markInputInvalid } from './dom-utils.js';
import { t } from './i18n.js';

export function initAnalysisSettingsModal({ state, onSave }) {
  const modal = document.getElementById('analysis-settings-modal');
  const form = document.getElementById('analysis-settings-form');
  const massSourceList = document.getElementById('analysis-mass-source-list');
  const selfWeightSelect = document.getElementById('analysis-self-weight-mode');
  const shearSelect = document.getElementById('analysis-ignore-shear-deformation');
  const errorEl = document.getElementById('analysis-settings-error');

  function applyI18n() {
    modal?.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = t(element.dataset.i18n);
    });
    renderMassSourceInputs();
  }

  function renderMassSourceInputs() {
    if (!massSourceList) return;
    const factors = state.analysisSettings?.massSources || {};
    massSourceList.innerHTML = LOAD_CASES.map(loadCase => {
      const value = factors[loadCase];
      return `<div class="settings-group">
        <label for="analysis-mass-${loadCase}">${escapeHtml(t(`loadCase${loadCase}`))} (${loadCase})</label>
        <input id="analysis-mass-${loadCase}" data-load-case="${loadCase}" type="number" min="0" step="any" value="${value ?? ''}" placeholder="${escapeHtml(t('analysisUndefined'))}">
      </div>`;
    }).join('');
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = '';
    massSourceList?.querySelectorAll('[aria-invalid="true"]').forEach(input => {
      input.removeAttribute('aria-invalid');
      clearInputInvalid(input);
    });
  }

  function show() {
    clearError();
    applyI18n();
    if (selfWeightSelect) {
      selfWeightSelect.value = state.analysisSettings?.selfWeightMode || 'fromDensity';
    }
    if (shearSelect) {
      const value = state.analysisSettings?.ignoreShearDeformation;
      shearSelect.value = typeof value === 'boolean' ? String(value) : '';
    }
    modal?.classList.add('visible');
  }

  function hide() {
    clearError();
    modal?.classList.remove('visible');
  }

  form?.addEventListener('submit', event => {
    event.preventDefault();
    clearError();
    const massSources = {};
    let invalidInput = null;
    massSourceList?.querySelectorAll('[data-load-case]').forEach(input => {
      const raw = input.value.trim();
      if (input.validity?.badInput) {
        invalidInput ||= input;
        return;
      }
      if (raw === '') {
        massSources[input.dataset.loadCase] = null;
        return;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) {
        invalidInput ||= input;
        return;
      }
      massSources[input.dataset.loadCase] = value;
    });
    if (invalidInput) {
      invalidInput.setAttribute('aria-invalid', 'true');
      markInputInvalid(invalidInput);
      if (errorEl) {
        errorEl.textContent = t('analysisInvalidMassSource');
        errorEl.hidden = false;
      }
      invalidInput.focus();
      return;
    }
    onSave({
      massSources,
      selfWeightMode: selfWeightSelect?.value || 'fromDensity',
      ignoreShearDeformation: shearSelect?.value === 'true' ? true
        : shearSelect?.value === 'false' ? false : null,
    });
    hide();
  });

  document.getElementById('btn-analysis-settings')?.addEventListener('click', show);
  document.getElementById('btn-analysis-settings-close')?.addEventListener('click', hide);
  document.getElementById('btn-analysis-settings-cancel')?.addEventListener('click', hide);

  return {
    show,
    hide,
    isOpen() {
      return !!modal?.classList.contains('visible');
    },
    applyLanguage: applyI18n,
  };
}
