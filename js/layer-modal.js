// layer-modal.js - layer (level) management modal.
// Handles the level list rendering, add / delete / rename / z editing.
// Dependencies (state, model-change callback, selector refresh) are injected
// through initLayerModal().

import { t } from './i18n.js';
import { markInputInvalid, clearInputInvalid } from './dom-utils.js';
import { showNotice } from './notice.js';
import { executeModelCommand } from './commands/model-command.js';

export function initLayerModal({ state, history, onModelChange, refreshLevelSelectors }) {
  const layerModal = document.getElementById('layer-modal');
  const layerListEl = document.getElementById('layer-list');
  const layerFormErrorEl = document.getElementById('layer-form-error');

  function clearLayerFormError() {
    if (!layerFormErrorEl) return;
    layerFormErrorEl.hidden = true;
    layerFormErrorEl.textContent = '';
    if (layerListEl) {
      layerListEl.querySelectorAll('.input-error').forEach(el => {
        clearInputInvalid(el);
      });
    }
  }

  function showLayerFormError(message, input = null) {
    if (!layerFormErrorEl) {
      showNotice(message, 'error');
      return;
    }
    clearLayerFormError();
    layerFormErrorEl.textContent = message;
    layerFormErrorEl.hidden = false;
    markInputInvalid(input);
  }

  function renderLayerList() {
    layerListEl.innerHTML = '';

    // Header row
    const header = document.createElement('div');
    header.className = 'layer-header-row';
    header.innerHTML = `
      <span style="min-width:28px">ID</span>
      <span style="flex:1" data-i18n="layerName">${t('layerName')}</span>
      <span style="width:90px" data-i18n="layerZ">${t('layerZ')}</span>
      <span style="width:26px"></span>
    `;
    layerListEl.appendChild(header);

    const sortedLevels = [...state.levels].sort((a, b) => a.z - b.z);
    for (const level of sortedLevels) {
      const row = document.createElement('div');
      row.className = 'layer-row';
      row.dataset.levelId = level.id;

      const idLabel = document.createElement('span');
      idLabel.className = 'layer-row-label';
      idLabel.textContent = level.id;

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = level.name;
      nameInput.addEventListener('change', () => {
        clearInputInvalid(nameInput);
        const { changed } = executeModelCommand(history, state,
          () => state.updateLevel(level.id, { name: nameInput.value }));
        clearLayerFormError();
        if (!changed) return;
        refreshLevelSelectors();
        onModelChange();
      });

      const zInput = document.createElement('input');
      zInput.type = 'number';
      zInput.value = level.z;
      zInput.step = '100';
      zInput.addEventListener('change', () => {
        clearInputInvalid(zInput);
        const newZ = Number(zInput.value);
        if (!zInput.value.trim() || !Number.isFinite(newZ)) {
          zInput.value = state.levels.find(item => item.id === level.id)?.z ?? level.z;
          return;
        }
        const duplicate = state.levels.some(l => l.id !== level.id && l.z === newZ);
        if (duplicate) {
          showLayerFormError(t('layerDuplicateZ'), zInput);
          zInput.value = level.z;
          return;
        }
        const { changed } = executeModelCommand(history, state,
          () => state.updateLevel(level.id, { z: newZ }));
        clearLayerFormError();
        if (!changed) return;
        refreshLevelSelectors();
        renderLayerList();
        onModelChange();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'layer-delete-btn';
      delBtn.textContent = '×';
      delBtn.title = t('layerDelete');
      delBtn.addEventListener('click', () => {
        if (state.levels.length <= 1) {
          showNotice(t('layerCannotDeleteLast'), 'error');
          return;
        }
        const usage = state.getLevelUsage(level.id);
        const total = usage.members.length + usage.surfaces.length
          + usage.loads.length + usage.supports.length;
        if (total > 0) {
          showNotice(
            t('layerInUse', {
              m: usage.members.length,
              s: usage.surfaces.length,
              l: usage.loads.length,
              p: usage.supports.length,
            }),
            'error'
          );
          return;
        }
        const { changed } = executeModelCommand(history, state, () => state.removeLevel(level.id));
        if (!changed) return;
        refreshLevelSelectors();
        clearLayerFormError();
        renderLayerList();
        onModelChange();
      });

      row.appendChild(idLabel);
      row.appendChild(nameInput);
      row.appendChild(zInput);
      row.appendChild(delBtn);
      layerListEl.appendChild(row);
    }
  }

  function showLayerModal() {
    clearLayerFormError();
    renderLayerList();
    layerModal.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    layerModal.classList.add('visible');
  }

  function hideLayerModal() {
    clearLayerFormError();
    layerModal.classList.remove('visible');
  }

  document.getElementById('btn-layer-manage').addEventListener('click', showLayerModal);
  document.getElementById('btn-layer-close').addEventListener('click', hideLayerModal);

  document.getElementById('btn-layer-add').addEventListener('click', () => {
    clearLayerFormError();
    let nextZ = state.levels.length > 0
      ? Math.max(...state.levels.map(l => l.z)) + 2800
      : 0;
    // Ensure no duplicate z
    while (state.levels.some(l => l.z === nextZ)) {
      nextZ += 100;
    }
    const name = `${state.levels.length + 1}F`;
    const { changed } = executeModelCommand(history, state, () => state.addLevel(name, nextZ));
    if (!changed) return;
    refreshLevelSelectors();
    renderLayerList();
    onModelChange();
  });

  layerModal.addEventListener('click', (e) => {
    if (e.target === layerModal) hideLayerModal();
  });

  return {
    hide: hideLayerModal,
    isOpen: () => layerModal.classList.contains('visible'),
    clearFormError: clearLayerFormError,
  };
}
