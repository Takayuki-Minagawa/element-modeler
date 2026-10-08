// Pure catalog table renderer, usable independently of either modal controller.
import { t } from '../../i18n.js';
import { escapeHtml } from '../../dom-utils.js';
import { normalizeSectionShape } from '../../section-catalog.js';
import { renderEndPresetCell, renderPropertySourceOptions, renderSelfWeightModeOptions, surfaceWeightFeedback, renderOptionalSpringOptions, renderPanelDirectionOptions, springReferenceLabel } from './fields.js';

const BUILT_IN_MATERIAL_NAMES = new Set(['steel', 'rc', 'wood']);

export function renderCatalogTable({ group, items, materials = [], springs = [] }) {
  // --- List modal rendering ---
  // Tables are generated from column definitions shared between the spring
  // list and the section list; actions are handled by event delegation on
  // the list body (data-action / data-symbol / data-name).

  function currentUserDefGroupLabel() {
    const kind = group.kind;
    if (kind === 'spring') return t('userDefSpring');
    if (kind === 'material') return t('userDefMaterial');
    const target = group.target;
    const type = group.type;
    return `${target === 'member' ? t('userDefTargetMember') : t('userDefTargetSurface')} / ${t(type)}`;
  }

  function renderMemoCell(item) {
    return item.isDefault
      ? escapeHtml(item.memo || '')
      : `<input type="text" class="user-def-table-input" data-field="memo" value="${escapeHtml(item.memo || '')}">`;
  }

  function renderDefaultFlagCell(item) {
    return item.isDefault ? t('userDefDefaultFlag') : t('userDefCustomFlag');
  }

  function renderActionsCell(item, { saveAction, removeAction, keyAttr, key, calculateAction = null }) {
    if (item.isDefault) return '-';
    return `<div class="user-def-table-actions">
      ${calculateAction ? `<button type="button" class="user-def-table-btn" data-action="${calculateAction}" ${keyAttr}="${escapeHtml(key)}">${t('userDefCalculateProperties')}</button>` : ''}
      <button type="button" class="user-def-table-btn" data-action="${saveAction}" ${keyAttr}="${escapeHtml(key)}">${t('userDefUpdate')}</button>
      <button type="button" class="user-def-table-btn" data-action="${removeAction}" ${keyAttr}="${escapeHtml(key)}">${t('userDefDelete')}</button>
    </div>`;
  }

  function renderSizeCell(item, field) {
    const value = item[field];
    return item.isDefault
      ? `${value ?? '-'}`
      : `<input type="number" class="user-def-table-input" data-field="${field}" min="1" step="1" value="${Number.isFinite(value) ? value : 1}">`;
  }

  function renderOptionalNumberCell(item, field, editable = !item.isDefault) {
    const value = item[field];
    if (!editable) return Number.isFinite(value) ? String(value) : '-';
    return `<input type="number" class="user-def-table-input" data-field="${field}" min="0" step="any" value="${Number.isFinite(value) ? value : ''}" placeholder="-">`;
  }

  function renderStiffnessCell(item, field) {
    const value = item[field] ?? '';
    if (item.isDefault) return escapeHtml(value === '' ? '-' : value);
    return `<input type="text" class="user-def-table-input" data-field="${field}" value="${escapeHtml(value)}" placeholder="1.0e9 / pin / rigid">`;
  }

  function renderPropertySourceCell(item) {
    if (item.isDefault) return escapeHtml(item.propertySource ? t({ catalog: 'userDefSourceCatalog', computed: 'userDefSourceComputed', manual: 'userDefSourceManual' }[item.propertySource]) : '-');
    return `<select class="user-def-table-input" data-field="propertySource">${renderPropertySourceOptions(item.propertySource)}</select>`;
  }

  function renderSelfWeightModeCell(item) {
    if (item.isDefault) return escapeHtml(item.selfWeightMode ? t(item.selfWeightMode === 'fromDensity' ? 'userDefWeightFromDensity' : 'userDefWeightManual') : '-');
    return `<select class="user-def-table-input" data-field="selfWeightMode">${renderSelfWeightModeOptions(item.selfWeightMode)}</select>`;
  }

  function renderPanelDirectionCell(item) {
    if (item.isDefault) return escapeHtml(item.panelDirection?.toUpperCase() || t('userDefUnspecified'));
    return `<select class="user-def-table-input" data-field="panelDirection">${renderPanelDirectionOptions(item.panelDirection)}</select>`;
  }

  function renderPanelSpringCell(item, field, symbol) {
    if (item.isDefault) return escapeHtml(springReferenceLabel(symbol, springs));
    return `<select class="user-def-table-input" data-field="${field}">${renderOptionalSpringOptions(springs, symbol)}</select>`;
  }

  function renderShapeOptions(selectedShape) {
    const shape = normalizeSectionShape(selectedShape);
    return [
      ['rectangle', t('userDefShapeRectangle')],
      ['hSection', t('userDefShapeHSection')],
      ['boxSection', t('userDefShapeBoxSection')],
    ].map(([value, label]) =>
      `<option value="${value}" ${value === shape ? 'selected' : ''}>${escapeHtml(label)}</option>`
    ).join('');
  }

  function renderShapeCell(section) {
    const shape = normalizeSectionShape(section.shape);
    if (section.isDefault) {
      return escapeHtml(t(shape === 'hSection' ? 'userDefShapeHSection' : (
        shape === 'boxSection' ? 'userDefShapeBoxSection' : 'userDefShapeRectangle'
      )));
    }
    return `<select class="user-def-table-input" data-field="shape">${renderShapeOptions(shape)}</select>`;
  }

  function renderOptionalRatioCell(item, field) {
    const value = item[field];
    if (item.isDefault) return Number.isFinite(value) ? String(value) : '-';
    return `<input type="number" class="user-def-table-input" data-field="${field}" min="0" max="1" step="any" value="${Number.isFinite(value) ? value : ''}" placeholder="-">`;
  }

  function renderRequiredNumberCell(item, field) {
    const value = item[field];
    return `<input type="number" class="user-def-table-input" data-field="${field}" min="0" step="any" value="${Number.isFinite(value) ? value : ''}">`;
  }

  function renderMaterialSelectCell(section) {
    if (section.isDefault) return escapeHtml(section.material || (section.target === 'surface' ? '-' : 'steel'));

    return `<select class="user-def-table-input" data-field="material">
      ${section.target === 'surface' ? `<option value="" ${!section.material ? 'selected' : ''}>${escapeHtml(t('userDefUnspecified'))}</option>` : ''}
      ${section.material && !materials.some(material => material.name === section.material) ? `<option value="${escapeHtml(section.material)}" selected>${escapeHtml(section.material)} (${escapeHtml(t('userDefMaterialMissing'))})</option>` : ''}
      ${materials.map(material => `<option value="${escapeHtml(material.name)}" ${material.name === section.material ? 'selected' : ''}>${escapeHtml(material.name)}</option>`).join('')}
    </select>`;
  }

  function renderColorCell(item) {
    return item.isDefault
      ? `<span style="display:inline-block;width:14px;height:14px;border:1px solid #999;vertical-align:middle;margin-right:6px;background:${escapeHtml(item.color || '#666666')};"></span>${escapeHtml(item.color || '')}`
      : `<input type="color" class="user-def-table-input" data-field="color" value="${escapeHtml(item.color || '#666666')}">`;
  }

  function buildSpringColumns() {
    return [
      { header: t('userDefListColName'), cell: s => escapeHtml(s.symbol) },
      { header: t('userDefKr'), cell: s => renderStiffnessCell(s, 'kr') },
      { header: t('userDefKrY'), cell: s => renderStiffnessCell(s, 'krY') },
      { header: t('userDefKrZ'), cell: s => renderStiffnessCell(s, 'krZ') },
      { header: t('userDefKt'), cell: s => renderStiffnessCell(s, 'kt') },
      { header: t('userDefKv'), cell: s => renderStiffnessCell(s, 'kv') },
      { header: t('userDefListColMemo'), cell: renderMemoCell },
      { header: t('userDefListColDefault'), cell: renderDefaultFlagCell },
      {
        header: t('userDefListColAction'),
        cell: s => renderActionsCell(s, {
          saveAction: 'save-spring',
          removeAction: 'remove-spring',
          keyAttr: 'data-symbol',
          key: s.symbol,
        }),
      },
    ];
  }

  function buildSectionColumns(hasSize, springDefs) {
    const columns = [
      { header: t('userDefListColName'), cell: s => escapeHtml(s.name) },
    ];
    if (hasSize) {
      columns.push(
        { header: t('userDefListColB'), cell: s => renderSizeCell(s, 'b') },
        { header: t('userDefListColH'), cell: s => renderSizeCell(s, 'h') },
        { header: t('userDefListColShape'), cell: renderShapeCell },
        { header: t('userDefListColFlangeThickness'), cell: s => renderOptionalNumberCell(s, 'flangeThickness') },
        { header: t('userDefListColWebThickness'), cell: s => renderOptionalNumberCell(s, 'webThickness') },
        { header: t('userDefListColBoxThickness'), cell: s => renderOptionalNumberCell(s, 'boxThickness') },
        { header: t('userDefListColMaterial'), cell: renderMaterialSelectCell },
        { header: t('userDefDesignation'), cell: s => s.isDefault ? escapeHtml(s.designation || '-') : `<input type="text" class="user-def-table-input" data-field="designation" value="${escapeHtml(s.designation || '')}">` },
        { header: t('userDefPropertySource'), cell: renderPropertySourceCell },
        { header: 'A', cell: s => renderOptionalNumberCell(s, 'A') },
        { header: 'Iy', cell: s => renderOptionalNumberCell(s, 'Iy') },
        { header: 'Iz', cell: s => renderOptionalNumberCell(s, 'Iz') },
        { header: 'J', cell: s => renderOptionalNumberCell(s, 'J') },
        { header: t('userDefAvy'), cell: s => renderOptionalNumberCell(s, 'Avy') },
        { header: t('userDefAvz'), cell: s => renderOptionalNumberCell(s, 'Avz') },
        { header: t('userDefListColShearAreaRatioY'), cell: s => renderOptionalRatioCell(s, 'shearAreaRatioY') },
        { header: t('userDefListColShearAreaRatioZ'), cell: s => renderOptionalRatioCell(s, 'shearAreaRatioZ') },
        { header: t('userDefListColEndI'), cell: s => renderEndPresetCell(s.defaultEndI, 'defaultEndI', !s.isDefault, springDefs) },
        { header: t('userDefListColEndJ'), cell: s => renderEndPresetCell(s.defaultEndJ, 'defaultEndJ', !s.isDefault, springDefs) },
      );
    } else {
      columns.push(
        { header: t('userDefListColMaterial'), cell: renderMaterialSelectCell },
        { header: t('userDefSurfaceThickness'), cell: s => renderOptionalNumberCell(s, 'thickness') },
        { header: t('userDefSelfWeightMode'), cell: renderSelfWeightModeCell },
        { header: t('userDefAdditionalWeight'), cell: s => renderOptionalNumberCell(s, 'additionalWeight') },
        { header: `${t('unitWeight')} (N/m²)`, cell: s => `<span data-field="weightPreview" aria-live="polite">${escapeHtml(surfaceWeightFeedback(s, materials.find(material => material.name === s.material)))}</span>` },
        { header: t('userDefPanelDirection'), cell: renderPanelDirectionCell },
        { header: t('userDefPanelEndSpring'), cell: s => renderPanelSpringCell(s, 'endRotationalSpring', s.endRotationalSpring) },
        { header: t('userDefPanelToPanelSpring'), cell: s => renderPanelSpringCell(s, 'panelToPanel', s.edgeSprings?.panelToPanel) },
        { header: t('userDefPanelToBeamSpring'), cell: s => renderPanelSpringCell(s, 'panelToBeam', s.edgeSprings?.panelToBeam) },
      );
    }
    columns.push(
      { header: t('userDefListColColor'), cell: renderColorCell },
      { header: t('userDefListColMemo'), cell: renderMemoCell },
      { header: t('userDefListColDefault'), cell: renderDefaultFlagCell },
      {
        header: t('userDefListColAction'),
        cell: s => renderActionsCell(s, {
          saveAction: 'save-section',
          removeAction: 'remove-section',
          calculateAction: hasSize ? 'calculate-section-row' : null,
          keyAttr: 'data-name',
          key: s.name,
        }),
      },
    );
    return columns;
  }

  function buildMaterialColumns() {
    return [
      { header: t('userDefListColName'), cell: material => escapeHtml(material.name) },
      { header: 'E (N/mm²)', cell: material => renderRequiredNumberCell(material, 'E') },
      { header: 'G (N/mm²)', cell: material => renderRequiredNumberCell(material, 'G') },
      { header: 'ρ (kg/m³)', cell: material => renderRequiredNumberCell(material, 'density') },
      { header: t('userDefListColDefault'), cell: renderDefaultFlagCell },
      {
        header: t('userDefListColAction'),
        cell: material => `<div class="user-def-table-actions">
          <button type="button" class="user-def-table-btn" data-action="save-material" data-material="${escapeHtml(material.name)}">${t('userDefUpdate')}</button>
          ${BUILT_IN_MATERIAL_NAMES.has(material.name) ? '' : `<button type="button" class="user-def-table-btn" data-action="remove-material" data-material="${escapeHtml(material.name)}">${t('userDefDelete')}</button>`}
        </div>`,
      },
    ];
  }

  function renderUserDefListTable(items, columns) {
    return `
      <p><b>${t('userDefListGroup')}:</b> ${escapeHtml(currentUserDefGroupLabel())}</p>
      <div class="user-def-table-scroll">
      <table>
        <thead>
          <tr>
            ${columns.map(c => `<th>${c.header}</th>`).join('\n            ')}
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr>
              ${columns.map(c => `<td>${c.cell(item).replaceAll('class="user-def-table-input"', `class="user-def-table-input" aria-label="${escapeHtml(c.header)}"`)}</td>`).join('\n              ')}
            </tr>
          `).join('')}
        </tbody>
      </table>
      </div>
    `;
  }

  if (!items.length && group.kind !== 'material') return `<p>${t('userDefListNoItems')}</p>`;
  const columns = group.kind === 'spring' ? buildSpringColumns()
    : group.kind === 'material' ? buildMaterialColumns()
      : buildSectionColumns(group.target === 'member', springs);
  return renderUserDefListTable(items, columns);
}
