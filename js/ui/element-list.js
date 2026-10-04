import { getLang, t } from '../i18n.js';
import { escapeHtml } from '../dom-utils.js';
import { focusIssue, focusMembers } from './focus-issue.js';
import { showInspector } from './inspector.js';
import { ELEMENT_COLLECTIONS, queryElements } from '../domain/element-query.js';

const PAGE_SIZE = 50;

export function initElementList({ state, ui, toolManager, activatePlanInput }) {
  const dialog = document.getElementById('element-list-dialog');
  const kind = document.getElementById('element-kind');
  const level = document.getElementById('element-level');
  const search = document.getElementById('element-search');
  const memberFilters = document.getElementById('element-member-filters');
  const memberType = document.getElementById('element-member-type');
  const section = document.getElementById('element-section');
  const selectMembers = document.getElementById('element-select-members');
  const rows = document.getElementById('element-rows');
  const previous = document.getElementById('element-prev');
  const next = document.getElementById('element-next');
  let page = 0, lastKey = '';
  let visibleRows = [];
  function findMatches() {
    const levelId = state.levels.find(item => JSON.stringify(item.id) === level.value)?.id ?? null;
    return queryElements(state, { kind: kind.value, levelId, search: search.value,
      memberType: memberType.value, sectionName: section.value });
  }
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
    const key = JSON.stringify([state.revision, getLang(), kind.value, level.value, search.value,
      memberType.value, section.value, page]);
    if (!force && lastKey === key) return;
    const selectedLevel = level.value;
    level.innerHTML = '<option value="all">' + escapeHtml(t('filterAll')) + '</option>' +
      state.levels.map(item => '<option value="' + escapeHtml(JSON.stringify(item.id)) + '">' +
        escapeHtml(item.name) + ' / Z ' + item.z + ' mm</option>').join('');
    level.value = state.levels.some(item => JSON.stringify(item.id) === selectedLevel) ? selectedLevel : 'all';
    const selectedSection = section.value;
    const sections = [...new Set(state.members.filter(item => memberType.value === 'all' || item.type === memberType.value)
      .map(item => item.sectionName).filter(Boolean))].sort();
    section.innerHTML = '<option value="">' + escapeHtml(t('filterAll')) + '</option>' +
      sections.map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('');
    section.value = sections.includes(selectedSection) ? selectedSection : '';
    memberFilters.hidden = kind.value !== 'member';
    const matches = findMatches();
    selectMembers.disabled = kind.value !== 'member' || matches.length === 0;
    selectMembers.textContent = t('elementSelectMembers', { count: kind.value === 'member' ? matches.length : 0 });
    page = Math.min(page, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
    const start = page * PAGE_SIZE;
    visibleRows = matches.slice(start, start + PAGE_SIZE);
    rows.innerHTML = visibleRows.map(({ item, elementType }, index) => {
      const levelName = state.levels.find(entry => entry.id === item.levelId)?.name || item.levelId || '—';
      return '<tr data-element-row="' + index + '" data-element-kind="' + elementType + '" data-element-id="' + escapeHtml(item.id) + '"><td><button type="button" aria-label="' +
        escapeHtml(t('elementSelect', { id: item.id })) + '">' + escapeHtml(item.id) + '</button></td><td>' +
        escapeHtml(t(item.type || elementType)) + '</td><td>' + escapeHtml(levelName) + '</td><td>' +
        escapeHtml(item.sectionName || '—') + '</td><td>' + escapeHtml(coordinates(item, elementType)) + '</td></tr>';
    }).join('');
    document.getElementById('element-list-count').textContent = t('elementPage', {
      total: matches.length, start: matches.length ? start + 1 : 0, end: Math.min(start + PAGE_SIZE, matches.length) });
    document.getElementById('element-list-empty').hidden = matches.length > 0;
    previous.disabled = page === 0;
    next.disabled = start + PAGE_SIZE >= matches.length;
    lastKey = JSON.stringify([state.revision, getLang(), kind.value, level.value, search.value,
      memberType.value, section.value, page]);
  }
  document.getElementById('btn-element-list').addEventListener('click', () => {
    page = 0;
    dialog.showModal();
    refresh(true);
  });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  for (const field of [kind, level, search, memberType, section]) field.addEventListener(field === search ? 'input' : 'change', () => {
    if (field === memberType) section.value = '';
    page = 0;
    refresh(true);
  });
  previous.addEventListener('click', () => { page--; refresh(true); });
  next.addEventListener('click', () => { page++; refresh(true); });
  rows.addEventListener('click', event => {
    const button = event.target.closest('button');
    const row = button?.closest('[data-element-row]');
    if (!row) return;
    const entry = visibleRows[Number(row.dataset.elementRow)];
    if (!entry) return;
    const ref = { elementType: entry.elementType, elementId: entry.item.id };
    if (!state[ELEMENT_COLLECTIONS[ref.elementType]].some(item => item.id === ref.elementId)) return refresh(true);
    applySelection(() => focusIssue(state, toolManager.canvas2d, ref));
  });
  selectMembers.addEventListener('click', () => {
    if (kind.value !== 'member') return;
    const ids = findMatches().map(({ item }) => item.id);
    if (!ids.length) return refresh(true);
    applySelection(() => focusMembers(state, toolManager.canvas2d, ids));
  });
  function applySelection(select) {
    toolManager.cancelPlacement();
    dialog.close();
    showInspector('properties', { reveal: true });
    activatePlanInput();
    select();
    ui.refreshLevelSelectors();
    ui.refreshToolState();
    activatePlanInput();
  }
  return { refresh };
}
