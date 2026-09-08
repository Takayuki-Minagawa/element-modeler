import { showInspector } from './inspector.js';
import { diagnosticTargets, filterDiagnostics, resolveDiagnosticTarget } from '../domain/diagnostics.js';
import { diagnosticText, formatDiagnostic } from './diagnostic-messages.js';
import { escapeHtml } from '../dom-utils.js';
import { getLang, t } from '../i18n.js';

export function renderDiagnostics(ui, issues, summaryHtml = '', { reveal = true } = {}) {
  const container = document.getElementById('model-check-content');
  if (!container) return;
  if (reveal) showInspector('checks', { reveal: true });
  ui._diagnosticIssues = issues;
  ui._diagnosticSummaryHtml = summaryHtml;
  const filters = ui._diagnosticFilters ||= { severity: 'all', elementType: 'all' };
  const lang = getLang();
  const label = (key, params) => escapeHtml(diagnosticText(key, lang, params));
  const option = (key, selected) => `<option value="${escapeHtml(key)}"${key === selected ? ' selected' : ''}>${label(key)}</option>`;
  const filtered = filterDiagnostics(issues, filters);
  const types = [...new Set(issues.flatMap(issue => diagnosticTargets(issue).map(ref => ref.elementType)))].sort();
  if (filters.elementType !== 'all' && !types.includes(filters.elementType)) types.push(filters.elementType);
  const targets = [];
  container.innerHTML = `${summaryHtml}
    <div class="diagnostic-filters">
      <label>${label('severity')} <select id="diagnostic-severity">${['all', 'error', 'warning', 'info'].map(key => option(key, filters.severity)).join('')}</select></label>
      <label>${label('elementType')} <select id="diagnostic-type">${['all', ...types].map(key => option(key, filters.elementType)).join('')}</select></label>
    </div>
    <p class="quantity-note" role="status">${label('count', { shown: filtered.length, total: issues.length })}</p>
    ${!filtered.length ? `<p class="quantity-note">${issues.length ? label('noMatches') : escapeHtml(t('modelCheckNoIssues'))}</p>` : ''}
    <ul class="model-check-list">${filtered.map(issue => `
      <li class="model-check-item model-check-${escapeHtml(issue.severity)}">
        <b>${label(issue.severity)}</b> ${escapeHtml(formatDiagnostic(issue, lang, t))}
        ${diagnosticTargets(issue).map(ref => {
    const target = resolveDiagnosticTarget(ui.state, ref);
    const index = targets.push({ ref, issue }) - 1;
    const note = !target ? 'missingTarget' : target.hidden ? 'hidden' : target.requiresLevelChange ? 'otherLevel' : '';
    return `<button type="button" data-diagnostic-target="${index}"${!target ? ' disabled' : ''}${note ? ` title="${label(note)}"` : ''}>${label(ref.elementType)} ${escapeHtml(ref.elementId)}</button>${note ? `<small>${label(note)}</small>` : ''}`;
  }).join('')}
      </li>`).join('')}</ul>`;
  const updateFilter = (id, key) => document.getElementById(id)?.addEventListener('change', event => {
    ui.setDiagnosticFilters({ [key]: event.target.value });
  });
  updateFilter('diagnostic-severity', 'severity');
  updateFilter('diagnostic-type', 'elementType');
  container.querySelectorAll('[data-diagnostic-target]').forEach(button => button.addEventListener('click', () => {
    const { ref, issue } = targets[Number(button.dataset.diagnosticTarget)];
    // Resolve again on activation: the model may have changed since rendering.
    const target = resolveDiagnosticTarget(ui.state, ref);
    if (!target) return;
    if (ui.callbacks.onFocusIssue) ui.callbacks.onFocusIssue({ ...issue, ...ref, target });
    else ui.callbacks.onDiagnosticSelect?.(target, issue);
  }));
}
