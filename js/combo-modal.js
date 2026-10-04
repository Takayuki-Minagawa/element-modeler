// combo-modal.js - Load combination management modal: a table of
// combination rows with one factor input per load case.

import { LOAD_CASES } from './constants.js';
import { t } from './i18n.js';
import { executeModelCommand } from './commands/model-command.js';

export function initComboModal({ state, history, onModelChange }) {
  const modal = document.getElementById('combo-modal');
  const listEl = document.getElementById('combo-list');

  function renderList() {
    listEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'layer-header-row';
    header.innerHTML = `
      <span style="flex:1">${t('comboName')}</span>
      ${LOAD_CASES.map(c => `<span style="width:52px">${c}</span>`).join('')}
      <span style="width:26px"></span>
    `;
    listEl.appendChild(header);

    for (const combo of state.loadCombinations) {
      const row = document.createElement('div');
      row.className = 'layer-row';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = combo.name;
      nameInput.style.flex = '1';
      nameInput.addEventListener('change', () => {
        const { changed } = executeModelCommand(history, state,
          () => state.updateLoadCombination(combo.id, { name: nameInput.value }));
        nameInput.value = state.loadCombinations.find(item => item.id === combo.id)?.name ?? combo.name;
        if (changed) onModelChange();
      });
      row.appendChild(nameInput);

      for (const loadCase of LOAD_CASES) {
        const factorInput = document.createElement('input');
        factorInput.type = 'number';
        factorInput.step = '0.1';
        factorInput.style.width = '52px';
        factorInput.value = combo.factors[loadCase] ?? 0;
        factorInput.addEventListener('change', () => {
          const current = state.loadCombinations.find(item => item.id === combo.id);
          const n = Number(factorInput.value);
          if (!factorInput.value.trim() || !Number.isFinite(n)) {
            factorInput.value = current?.factors[loadCase] ?? 0;
            return;
          }
          const factors = { ...current?.factors, [loadCase]: n };
          const { changed } = executeModelCommand(history, state,
            () => state.updateLoadCombination(combo.id, { factors }));
          factorInput.value = state.loadCombinations
            .find(c => c.id === combo.id)?.factors[loadCase] ?? 0;
          if (changed) onModelChange();
        });
        row.appendChild(factorInput);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'layer-delete-btn';
      delBtn.textContent = '×';
      delBtn.title = t('comboDelete');
      delBtn.addEventListener('click', () => {
        const { changed } = executeModelCommand(history, state,
          () => state.removeLoadCombination(combo.id));
        if (!changed) return;
        renderList();
        onModelChange();
      });
      row.appendChild(delBtn);

      listEl.appendChild(row);
    }
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

  document.getElementById('btn-combo-close').addEventListener('click', hide);
  document.getElementById('btn-combo-add').addEventListener('click', () => {
    const { changed } = executeModelCommand(history, state,
      () => state.addLoadCombination(null, { DL: 1 }));
    if (!changed) return;
    renderList();
    onModelChange();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) hide();
  });

  return {
    show,
    hide,
    isOpen: () => modal.classList.contains('visible'),
  };
}
