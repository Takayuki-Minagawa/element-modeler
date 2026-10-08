// Catalog tables and delegated edit/remove actions; the group is supplied by the caller.
import { t } from '../../i18n.js';
import { markInputInvalid, clearInputInvalid } from '../../dom-utils.js';
import { showNotice } from '../../notice.js';
import { calculateSectionPropertiesFromShape } from '../../section-catalog.js';
import { applyI18nTo, syncEndSpringVisibility, readRowEndPreset, readOptionalPositiveInput, readOptionalNonNegativeInput, readSpringStiffnessInput, readRequiredPositiveInput, readOptionalRatioInput, readSectionShapeInputs, calculatedIntegerProperties, applyCalculatedProperties, surfaceWeightFeedback } from './fields.js';

import { renderCatalogTable } from './table.js';

export function createUserDefList({ state, commands, getGroup, onModelChange, refreshDraftSectionSelectors, refreshMaterialSelectOptions }) {
  const userDefListModal = document.getElementById('user-def-list-modal');
  const userDefListBody = document.getElementById('user-def-list-body');
  function renderUserDefGroupList() {
    if (!userDefListBody) return;
    const group = getGroup();
    const items = group.kind === 'spring' ? state.listSprings()
      : group.kind === 'material' ? state.listMaterials()
        : state.listSections(group.target, group.type);
    userDefListBody.innerHTML = renderCatalogTable({
      group, items, materials: state.listMaterials(), springs: state.listSprings(),
    });
  }

  // --- List modal actions (event delegation) ---

  function saveSectionRow(btn) {
    const target = getGroup().target;
    const type = getGroup().type;
    const name = btn.dataset.name || '';
    const row = btn.closest('tr');
    if (!row) return;

    const patch = {};
    const colorEl = row.querySelector('[data-field="color"]');
    if (colorEl) patch.color = colorEl.value;
    const memoEl = row.querySelector('[data-field="memo"]');
    if (memoEl) patch.memo = memoEl.value;

    if (target === 'member') {
      const bInput = row.querySelector('[data-field="b"]');
      const hInput = row.querySelector('[data-field="h"]');
      clearInputInvalid(bInput);
      clearInputInvalid(hInput);
      const b = readRequiredPositiveInput(bInput).value;
      const h = readRequiredPositiveInput(hInput).value;
      if (!(Number.isFinite(b) && b > 0 && Number.isFinite(h) && h > 0)) {
        markInputInvalid(bInput);
        markInputInvalid(hInput);
        showNotice(t('userDefInvalidSize'), 'error');
        return;
      }
      patch.b = b;
      patch.h = h;
      const shape = readSectionShapeInputs({
        shapeSelect: row.querySelector('[data-field="shape"]'),
        flangeThicknessInput: row.querySelector('[data-field="flangeThickness"]'),
        webThicknessInput: row.querySelector('[data-field="webThickness"]'),
        boxThicknessInput: row.querySelector('[data-field="boxThickness"]'),
      });
      if (!shape.valid || !calculateSectionPropertiesFromShape({ b, h, ...shape.value })) {
        markInputInvalid(shape.input || row.querySelector('[data-field="shape"]'));
        showNotice(t('userDefInvalidShape'), 'error');
        return;
      }
      Object.assign(patch, shape.value);
      patch.material = row.querySelector('[data-field="material"]')?.value || 'steel';
      patch.designation = row.querySelector('[data-field="designation"]')?.value?.trim() || null;
      patch.propertySource = row.querySelector('[data-field="propertySource"]')?.value || null;
      for (const property of ['A', 'Iy', 'Iz', 'J', 'Avy', 'Avz']) {
        const input = row.querySelector(`[data-field="${property}"]`);
        const result = readOptionalPositiveInput(input);
        if (!result.valid) {
          markInputInvalid(input);
          showNotice(t('userDefInvalidProperty'), 'error');
          return;
        }
        patch[property] = result.value;
      }
      for (const ratio of ['shearAreaRatioY', 'shearAreaRatioZ']) {
        const input = row.querySelector(`[data-field="${ratio}"]`);
        const result = readOptionalRatioInput(input);
        if (!result.valid) {
          markInputInvalid(input);
          showNotice(t('userDefInvalidShearAreaRatio'), 'error');
          return;
        }
        patch[ratio] = result.value;
      }
      patch.defaultEndI = readRowEndPreset(row, 'defaultEndI');
      patch.defaultEndJ = readRowEndPreset(row, 'defaultEndJ');
    } else {
      patch.material = row.querySelector('[data-field="material"]')?.value || null;
      patch.selfWeightMode = row.querySelector('[data-field="selfWeightMode"]')?.value || null;
      for (const field of ['thickness', 'additionalWeight']) {
        const input = row.querySelector(`[data-field="${field}"]`);
        const result = field === 'thickness' ? readOptionalPositiveInput(input) : readOptionalNonNegativeInput(input);
        if (!result.valid) {
          markInputInvalid(input);
          showNotice(t('userDefInvalidSurfaceWeight'), 'error');
          return;
        }
        patch[field] = result.value;
      }
    }

    const updated = commands.updateSection(target, type, name, patch);
    if (updated === undefined) return;
    if (!updated) {
      showNotice(t('userDefUpdateFailed'), 'error');
      return;
    }
    showNotice(t('userDefUpdated') || t('userDefUpdate'), 'success');
    onModelChange();
    renderUserDefGroupList();
  }

  function calculateSectionRow(btn) {
    const row = btn.closest('tr');
    if (!row) return;
    const bInput = row.querySelector('[data-field="b"]');
    const hInput = row.querySelector('[data-field="h"]');
    const b = readRequiredPositiveInput(bInput);
    const h = readRequiredPositiveInput(hInput);
    if (!b.valid || !h.valid) {
      markInputInvalid(!b.valid ? bInput : hInput);
      showNotice(t('userDefInvalidSize'), 'error');
      return;
    }
    const shape = readSectionShapeInputs({
      shapeSelect: row.querySelector('[data-field="shape"]'),
      flangeThicknessInput: row.querySelector('[data-field="flangeThickness"]'),
      webThicknessInput: row.querySelector('[data-field="webThickness"]'),
      boxThicknessInput: row.querySelector('[data-field="boxThickness"]'),
    });
    const properties = shape.valid
      ? calculatedIntegerProperties({ b: b.value, h: h.value, ...shape.value })
      : null;
    if (!properties) {
      markInputInvalid(shape.input || row.querySelector('[data-field="shape"]'));
      showNotice(t('userDefInvalidShape'), 'error');
      return;
    }
    applyCalculatedProperties(properties, {
      A: row.querySelector('[data-field="A"]'),
      Iy: row.querySelector('[data-field="Iy"]'),
      Iz: row.querySelector('[data-field="Iz"]'),
      J: row.querySelector('[data-field="J"]'),
    });
    const source = row.querySelector('[data-field="propertySource"]');
    if (source) source.value = 'computed';
  }

  function saveSpringRow(btn) {
    const symbol = btn.dataset.symbol || '';
    const row = btn.closest('tr');
    if (!row) return;
    const memo = row.querySelector('[data-field="memo"]')?.value || '';
    const stiffness = {};
    for (const field of ['kr', 'krY', 'krZ', 'kt']) {
      const input = row.querySelector(`[data-field="${field}"]`);
      clearInputInvalid(input);
      const result = readSpringStiffnessInput(input);
      if (!result.valid) {
        markInputInvalid(input);
        showNotice(t('userDefInvalidStiffness'), 'error');
        return;
      }
      stiffness[field] = result.value;
    }
    const updated = commands.updateSpring(symbol, { ...stiffness, memo });
    if (updated === undefined) return;
    if (!updated) {
      showNotice(t('userDefUpdateFailed'), 'error');
      return;
    }
    showNotice(t('userDefUpdated') || t('userDefUpdate'), 'success');
    onModelChange();
    renderUserDefGroupList();
  }

  function saveMaterialRow(btn) {
    const name = btn.dataset.material || '';
    const row = btn.closest('tr');
    if (!row) return;
    const values = {};
    for (const field of ['E', 'G', 'density']) {
      const input = row.querySelector(`[data-field="${field}"]`);
      const result = readRequiredPositiveInput(input);
      if (!result.valid) {
        markInputInvalid(input);
        showNotice(t('userDefInvalidMaterial'), 'error');
        return;
      }
      values[field] = result.value;
    }
    const updated = commands.updateMaterial(name, values);
    if (updated === undefined) return;
    if (!updated) {
      showNotice(t('userDefUpdateFailed'), 'error');
      return;
    }
    showNotice(t('userDefUpdated'), 'success');
    onModelChange();
    refreshMaterialSelectOptions();
    renderUserDefGroupList();
  }

  function removeSectionRow(btn) {
    const target = getGroup().target;
    const type = getGroup().type;
    const name = btn.dataset.name || '';
    if (!name) return;
    const confirmed = window.confirm(
      t('userDefDeleteConfirm', { name })
    );
    if (!confirmed) return;
    const removed = commands.removeSection(target, type, name);
    if (!removed) {
      showNotice(t('userDefDeleteFailed'), 'error');
      return;
    }
    showNotice(t('userDefDeleted') || t('userDefDelete'), 'success');
    onModelChange();
    refreshDraftSectionSelectors();
    renderUserDefGroupList();
  }

  function removeSpringRow(btn) {
    const symbol = btn.dataset.symbol || '';
    if (!symbol) return;
    const confirmed = window.confirm(
      t('userDefDeleteConfirm', { name: symbol })
    );
    if (!confirmed) return;
    const removed = commands.removeSpring(symbol);
    if (!removed) {
      showNotice(t('userDefDeleteFailed'), 'error');
      return;
    }
    showNotice(t('userDefDeleted') || t('userDefDelete'), 'success');
    onModelChange();
    refreshDraftSectionSelectors();
    renderUserDefGroupList();
  }

  function removeMaterialRow(btn) {
    const name = btn.dataset.material || '';
    if (!name) return;
    if (!window.confirm(t('userDefDeleteConfirm', { name }))) return;
    if (!commands.removeMaterial(name)) {
      showNotice(t('userDefDeleteFailed'), 'error');
      return;
    }
    showNotice(t('userDefDeleted'), 'success');
    onModelChange();
    refreshMaterialSelectOptions();
    renderUserDefGroupList();
  }

  function showUserDefListModal() {
    applyI18nTo(userDefListModal);
    renderUserDefGroupList();
    userDefListModal.classList.add('visible');
  }

  function hideUserDefListModal() {
    userDefListModal.classList.remove('visible');
  }

  function refreshSurfaceRowPreview(event) {
    const field = event.target.dataset?.field;
    if (['material', 'thickness', 'selfWeightMode', 'additionalWeight'].includes(field)) {
      const row = event.target.closest('tr');
      const preview = row?.querySelector('[data-field="weightPreview"]');
      if (preview) preview.textContent = surfaceWeightFeedback({
        selfWeightMode: row.querySelector('[data-field="selfWeightMode"]')?.value || null,
        thickness: readOptionalPositiveInput(row.querySelector('[data-field="thickness"]')).value,
        additionalWeight: readOptionalNonNegativeInput(row.querySelector('[data-field="additionalWeight"]')).value,
      }, state.getMaterial(row.querySelector('[data-field="material"]')?.value));
    }
  }

  // Update previews while typing. Updating their height only on blur can move
  // the centered dialog between pointer-down and pointer-up on the Save button.
  userDefListBody?.addEventListener('input', refreshSurfaceRowPreview);
  userDefListBody?.addEventListener('change', (event) => {
    refreshSurfaceRowPreview(event);
    const conditionEl = event.target.closest('[data-field$="Condition"]');
    if (!conditionEl) return;
    const springField = conditionEl.dataset.field.replace('Condition', 'Spring');
    const springEl = conditionEl.closest('td')?.querySelector(`[data-field="${springField}"]`);
    syncEndSpringVisibility(conditionEl, springEl);
  });

  userDefListBody?.addEventListener('click', (event) => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    switch (btn.dataset.action) {
      case 'calculate-section-row': calculateSectionRow(btn); break;
      case 'save-section': saveSectionRow(btn); break;
      case 'save-spring': saveSpringRow(btn); break;
      case 'save-material': saveMaterialRow(btn); break;
      case 'remove-section': removeSectionRow(btn); break;
      case 'remove-spring': removeSpringRow(btn); break;
      case 'remove-material': removeMaterialRow(btn); break;
    }
  });

  document.getElementById('btn-user-def-list').addEventListener('click', showUserDefListModal);
  document.getElementById('btn-user-def-list-close').addEventListener('click', hideUserDefListModal);
  return {
    show: showUserDefListModal,
    isOpen: () => userDefListModal.classList.contains('visible'),
    refresh() {
      if (userDefListModal.classList.contains('visible')) renderUserDefGroupList();
    },
    applyLanguage() {
      applyI18nTo(userDefListModal);
      if (userDefListModal.classList.contains('visible')) renderUserDefGroupList();
    },
  };
}
