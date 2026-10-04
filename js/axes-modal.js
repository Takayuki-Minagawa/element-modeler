// axes-modal.js - Grid axis (通り芯) management modal: list, add, edit, delete.
// Dependencies are injected through initAxesModal().

import { t } from './i18n.js';
import { executeModelCommand } from './commands/model-command.js';

export function initAxesModal({ state, history, onModelChange }) {
  const modal = document.getElementById('axes-modal');
  const listEl = document.getElementById('axes-list');

  function renderList() {
    listEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'layer-header-row';
    header.innerHTML = `
      <span style="width:56px">${t('axisDir')}</span>
      <span style="flex:1">${t('axisName')}</span>
      <span style="width:110px">${t('axisCoord')}</span>
      <span style="width:26px"></span>
    `;
    listEl.appendChild(header);

    const sorted = [...state.axes].sort((a, b) =>
      a.dir === b.dir ? a.coord - b.coord : (a.dir === 'x' ? -1 : 1)
    );
    for (const axis of sorted) {
      const row = document.createElement('div');
      row.className = 'layer-row';

      const dirSel = document.createElement('select');
      dirSel.innerHTML = `
        <option value="x">X</option>
        <option value="y">Y</option>
      `;
      dirSel.value = axis.dir;
      dirSel.style.width = '56px';
      dirSel.addEventListener('change', () => {
        const { changed } = executeModelCommand(history, state,
          () => state.updateAxis(axis.id, { dir: dirSel.value }));
        if (!changed) return;
        renderList();
        onModelChange();
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = axis.name;
      nameInput.addEventListener('change', () => {
        const { changed } = executeModelCommand(history, state,
          () => state.updateAxis(axis.id, { name: nameInput.value }));
        nameInput.value = state.getAxis(axis.id)?.name ?? axis.name;
        if (changed) onModelChange();
      });

      const coordInput = document.createElement('input');
      coordInput.type = 'number';
      coordInput.step = '100';
      coordInput.value = axis.coord;
      coordInput.style.width = '110px';
      coordInput.addEventListener('change', () => {
        const value = Number(coordInput.value);
        if (!coordInput.value.trim() || !Number.isFinite(value)) {
          coordInput.value = state.getAxis(axis.id)?.coord ?? axis.coord;
          return;
        }
        const { changed } = executeModelCommand(history, state,
          () => state.updateAxis(axis.id, { coord: value }));
        if (!changed) return;
        renderList();
        onModelChange();
      });

      const delBtn = document.createElement('button');
      delBtn.className = 'layer-delete-btn';
      delBtn.textContent = '×';
      delBtn.title = t('axisDelete');
      delBtn.addEventListener('click', () => {
        const { changed } = executeModelCommand(history, state, () => state.removeAxis(axis.id));
        if (!changed) return;
        renderList();
        onModelChange();
      });

      row.appendChild(dirSel);
      row.appendChild(nameInput);
      row.appendChild(coordInput);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    }
  }

  function addAxis(dir) {
    const siblings = state.axes.filter(a => a.dir === dir);
    const coord = siblings.length
      ? Math.max(...siblings.map(a => a.coord)) + (state.settings.gridSize || 1000)
      : 0;
    const { changed } = executeModelCommand(history, state, () => state.addAxis(dir, null, coord));
    if (!changed) return;
    renderList();
    onModelChange();
  }

  function show() {
    renderList();
    modal.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    modal.classList.add('visible');
  }

  function hide() {
    modal.classList.remove('visible');
  }

  document.getElementById('btn-axes-manage').addEventListener('click', show);
  document.getElementById('btn-axes-close').addEventListener('click', hide);
  document.getElementById('btn-axes-add-x').addEventListener('click', () => addAxis('x'));
  document.getElementById('btn-axes-add-y').addEventListener('click', () => addAxis('y'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hide();
  });

  return {
    show,
    hide,
    isOpen: () => modal.classList.contains('visible'),
  };
}
