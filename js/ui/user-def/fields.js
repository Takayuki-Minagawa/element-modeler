// Shared field readers and section/end-preset presentation for forms and tables.
import { t } from '../../i18n.js';
import { escapeHtml } from '../../dom-utils.js';
import { calculateSectionPropertiesFromShape, normalizeSectionShape } from '../../section-catalog.js';
import { calculateSurfaceUnitWeight } from '../../surface-weight.js';

export const END_CONDITIONS = ['pin', 'rigid', 'spring'];

export function readEndPreset(conditionEl, springEl) {
  const condition = conditionEl?.value || 'pin';
  return {
    condition,
    springSymbol: condition === 'spring' ? (springEl?.value || null) : null,
  };
}

export function endConditionLabel(condition) {
  if (condition === 'rigid') return t('endRigid');
  if (condition === 'spring') return t('endSpring');
  return t('endPin');
}

export function formatEndPreset(endInfo) {
  const condition = END_CONDITIONS.includes(endInfo?.condition) ? endInfo.condition : 'pin';
  if (condition === 'spring') {
    return `${t('endSpring')} ${endInfo?.springSymbol || '-'}`;
  }
  return endConditionLabel(condition);
}

export function renderEndConditionOptions(selectedCondition = 'pin') {
  return END_CONDITIONS.map(condition =>
    `<option value="${condition}" ${condition === selectedCondition ? 'selected' : ''}>${escapeHtml(endConditionLabel(condition))}</option>`
  ).join('');
}

export function renderSpringOptions(springs, selectedSymbol = '') {
  const selected = selectedSymbol || springs[0]?.symbol || '';
  return springs.map(s =>
    `<option value="${escapeHtml(s.symbol)}" ${s.symbol === selected ? 'selected' : ''}>${escapeHtml(s.symbol)}</option>`
  ).join('');
}

export function springReferenceLabel(symbol, springs) {
  if (!symbol) return t('userDefUnspecified');
  return springs.some(spring => spring.symbol === symbol)
    ? symbol : `${symbol} (${t('userDefSpringMissing')})`;
}

export function renderOptionalSpringOptions(springs, selectedSymbol = '') {
  const selected = selectedSymbol || '';
  const symbols = springs.map(spring => spring.symbol);
  if (selected && !symbols.includes(selected)) symbols.unshift(selected);
  return ['', ...symbols].map(symbol =>
    `<option value="${escapeHtml(symbol)}" ${symbol === selected ? 'selected' : ''}>${escapeHtml(springReferenceLabel(symbol, springs))}</option>`
  ).join('');
}

export function renderPanelDirectionOptions(selectedDirection) {
  const selected = selectedDirection || '';
  return [['', t('userDefUnspecified')], ['x', 'X'], ['y', 'Y']].map(([value, label]) =>
    `<option value="${value}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`
  ).join('');
}

export function renderEndPresetCell(endInfo, fieldPrefix, editable, springs) {
  const condition = END_CONDITIONS.includes(endInfo?.condition) ? endInfo.condition : 'pin';
  const springSymbol = endInfo?.springSymbol || springs[0]?.symbol || '';
  if (!editable) {
    return escapeHtml(formatEndPreset({ condition, springSymbol }));
  }
  return `
    <select class="user-def-table-input" data-field="${fieldPrefix}Condition">
      ${renderEndConditionOptions(condition)}
    </select>
    <select class="user-def-table-input" data-field="${fieldPrefix}Spring" style="${condition === 'spring' ? '' : 'display:none;'}">
      ${renderSpringOptions(springs, springSymbol)}
    </select>
  `;
}

export function readRowEndPreset(row, fieldPrefix) {
  return readEndPreset(
    row.querySelector(`[data-field="${fieldPrefix}Condition"]`),
    row.querySelector(`[data-field="${fieldPrefix}Spring"]`)
  );
}

export function readOptionalPositiveInput(input) {
  if (input?.validity?.badInput) return { valid: false, value: null };
  const raw = input?.value?.trim() || '';
  if (raw === '') return { valid: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) && value > 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

export function readOptionalNonNegativeInput(input) {
  if (input?.validity?.badInput) return { valid: false, value: null };
  const raw = input?.value?.trim() || '';
  if (raw === '') return { valid: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

export function readSpringStiffnessInput(input) {
  const raw = input?.value?.trim() || '';
  if (raw === 'pin' || raw === 'rigid') return { valid: true, value: raw };
  return readOptionalPositiveInput(input);
}

export function renderPropertySourceOptions(selected = '') {
  return [['', 'userDefUnspecified'], ['catalog', 'userDefSourceCatalog'], ['computed', 'userDefSourceComputed'], ['manual', 'userDefSourceManual']]
    .map(([value, key]) => `<option value="${value}" ${value === (selected || '') ? 'selected' : ''}>${escapeHtml(t(key))}</option>`).join('');
}

export function renderSelfWeightModeOptions(selected = '') {
  return [['', 'userDefUnspecified'], ['manual', 'userDefWeightManual'], ['fromDensity', 'userDefWeightFromDensity']]
    .map(([value, key]) => `<option value="${value}" ${value === (selected || '') ? 'selected' : ''}>${escapeHtml(t(key))}</option>`).join('');
}

export function surfaceWeightFeedback(section, material) {
  if (section?.selfWeightMode !== 'fromDensity') return t('userDefSurfaceWeightManualHint');
  const total = calculateSurfaceUnitWeight(section, material);
  if (total !== null) return t('userDefSurfaceWeightCalculated', { value: Number(total.toFixed(4)) });
  const missing = [];
  if (!Number.isFinite(material?.density) || material.density <= 0) missing.push(t('userDefMaterialDensity'));
  if (!Number.isFinite(section.thickness) || section.thickness <= 0) missing.push(t('userDefSurfaceThickness'));
  if (!Number.isFinite(section.additionalWeight) || section.additionalWeight < 0) missing.push(t('userDefAdditionalWeight'));
  return t('userDefSurfaceWeightIncomplete', { fields: missing.join(', ') });
}

export function readRequiredPositiveInput(input) {
  const value = Number(input?.value);
  return Number.isFinite(value) && value > 0
    ? { valid: true, value }
    : { valid: false, value: null };
}

export function readOptionalRatioInput(input) {
  if (input?.validity?.badInput) return { valid: false, value: null };
  const raw = input?.value?.trim() || '';
  if (raw === '') return { valid: true, value: null };
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= 1
    ? { valid: true, value }
    : { valid: false, value: null };
}

export function readSectionShapeInputs({ shapeSelect, flangeThicknessInput, webThicknessInput, boxThicknessInput }) {
  const shape = normalizeSectionShape(shapeSelect?.value);
  const values = {
    shape,
    flangeThickness: null,
    webThickness: null,
    boxThickness: null,
  };
  const requiredInputs = shape === 'hSection'
    ? [['flangeThickness', flangeThicknessInput], ['webThickness', webThicknessInput]]
    : (shape === 'boxSection' ? [['boxThickness', boxThicknessInput]] : []);
  for (const [field, input] of requiredInputs) {
    const result = readOptionalPositiveInput(input);
    if (!result.valid || result.value === null) return { valid: false, input, value: values };
    values[field] = result.value;
  }
  return { valid: true, input: null, value: values };
}

export function calculatedIntegerProperties(section) {
  const calculated = calculateSectionPropertiesFromShape(section);
  if (!calculated) return null;
  return Object.fromEntries(
    Object.entries(calculated).map(([property, value]) => [property, Math.round(value)])
  );
}

export function applyCalculatedProperties(properties, inputs) {
  for (const property of ['A', 'Iy', 'Iz', 'J']) {
    const input = inputs[property];
    if (input) input.value = String(properties[property]);
  }
}


export function applyI18nTo(root) {
  root?.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
}

export function syncEndSpringVisibility(conditionEl, springEl) {
  if (!conditionEl || !springEl) return;
  springEl.hidden = conditionEl.value !== 'spring';
  springEl.style.display = conditionEl.value === 'spring' ? '' : 'none';
}
