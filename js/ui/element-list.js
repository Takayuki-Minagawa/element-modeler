import { getLang, t } from '../i18n.js';
import { escapeHtml } from '../dom-utils.js';
import { focusIssue } from './focus-issue.js';
import { showInspector } from './inspector.js';

const PAGE_SIZE = 50;
const collections = { member: 'members', surface: 'surfaces', load: 'loads', support: 'supports' };

export function initElementList({ state, ui, toolManager, activatePlanInput }) {
  const dialog = document.getElementById('element-list-dialog');
  const kind = document.getElementById('element-kind');
  const level = document.getElementById('element-level');
  const search = document.getElementById('element-search');
  const rows = document.getElementById('element-rows');
  const previous = document.getElementById('element-prev');
  const next = document.getElementById('element-next');
  let page = 0, lastKey = '';
  function coordinates(item, elementType) {
    let points;
    if (elementType === 'member') points = [state.getNode(item.startNodeId), state.getNode(item.endNodeId)];
    else if (elementType === 'support') points = [item];
    else points = item.points?.length ? item.points : [
      { x: item.x1, y: item.y1 }, { x: item.x2 ?? item.x1, y: item.y2 ?? item.y1 }];
    return points.filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      .map(p => '(' + p.x + ', ' + p.y + ')').join(' → ');
  }
  function refresh(force = false) {
    if (!dialog.open) return;
    const key = JSON.stringify([state.revision, getLang(), kind.value, level.value, search.value, page]);
    if (!force && lastKey === key) return;
    lastKey = key;
    const selectedLevel = level.value;
    level.innerHTML = '<option value="all">' + escapeHtml(t('filterAll')) + '</option>' +
      state.levels.map(item => '<option value="' + escapeHtml(item.id) + '">' +
        escapeHtml(item.name) + ' / Z ' + item.z + ' mm</option>').join('');
    level.value = state.levels.some(item => item.id === selectedLevel) ? selectedLevel : 'all';
    const query = search.value.trim().toLowerCase();
    const matches = Object.entries(collections).flatMap(([elementType, collection]) =>
      state[collection].filter(item =>
        (kind.value === 'all' || kind.value === elementType) &&
        (level.value === 'all' || level.value === item.levelId) &&
        (!query || String(item.id).toLowerCase().includes(query) ||
          String(item.sectionName || '').toLowerCase().includes(query))
      ).map(item => ({ item, elementType })));
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
    const start = page * PAGE_SIZE;
    rows.innerHTML = matches.slice(start, start + PAGE_SIZE).map(({ item, elementType }) => {
      const levelName = state.levels.find(entry => entry.id === item.levelId)?.name || item.levelId || '—';
      return '<tr data-element-kind="' + elementType + '" data-element-id="' + escapeHtml(item.id) + '"><td><button type="button" aria-label="' +
        escapeHtml(t('elementSelect', { id: item.id })) + '">' + escapeHtml(item.id) + '</button></td><td>' +
        escapeHtml(t(item.type || elementType)) + '</td><td>' + escapeHtml(levelName) + '</td><td>' +
        escapeHtml(item.sectionName || '—') + '</td><td>' + escapeHtml(coordinates(item, elementType)) + '</td></tr>';
    }).join('');
    document.getElementById('element-list-count').textContent = t('elementPage', {
      total: matches.length, start: matches.length ? start + 1 : 0, end: Math.min(start + PAGE_SIZE, matches.length) });
    document.getElementById('element-list-empty').hidden = matches.length > 0;
    previous.disabled = page === 0;
    next.disabled = start + PAGE_SIZE >= matches.length;
  }
  document.getElementById('btn-element-list').addEventListener('click', () => {
    page = 0;
    dialog.showModal();
    refresh(true);
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  for (const field of [kind, level, search]) field.addEventListener(field === search ? 'input' : 'change', () => {
    page = 0;
    refresh(true);
  });
  previous.addEventListener('click', () => { page--; refresh(true); });
  next.addEventListener('click', () => { page++; refresh(true); });
  rows.addEventListener('click', event => {
    const button = event.target.closest('button');
    const row = button?.closest('[data-element-id]');
    if (!row) return;
    const ref = { elementType: row.dataset.elementKind, elementId: row.dataset.elementId };
    if (!state[collections[ref.elementType]].some(item => item.id === ref.elementId)) return refresh(true);
    toolManager.cancelPlacement();
    dialog.close();
    activatePlanInput();
    focusIssue(state, toolManager.canvas2d, ref);
    ui.refreshLevelSelectors();
    ui.refreshToolState();
    showInspector('properties', { reveal: true });
    activatePlanInput();
  });
  return { refresh };
}
