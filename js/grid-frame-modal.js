// grid-frame-modal.js - Initial column/beam grid frame generation dialog.
// Parsing and model construction stay DOM-independent in frame-generator.js;
// this module owns only modal state and the whole-model replacement flow.

import {
  buildGridFrame,
  MAX_GRID_DIMENSION_MM,
  MAX_SPAN_COUNT,
  MAX_STORY_COUNT,
  MIN_GRID_DIMENSION_MM,
  parseMmList,
} from './frame-generator.js';
import { modelHasContent } from './autosave.js';
import { t } from './i18n.js';
import { showNotice } from './notice.js';
import { createDefaultLevels } from './state.js';
import { hasProvisionalEdit } from './domain/provisional-edit.js';

const PARSE_ERROR_KEYS = {
  empty: 'gridFrameEmptyInput',
  invalid: 'gridFrameInvalidInput',
  range: 'gridFrameOutOfRange',
  count: 'gridFrameTooMany',
};

export const GRID_FRAME_INPUT_STORAGE_KEY = 'lineframe-grid-frame-input';
export const GRID_FRAME_PRESETS_STORAGE_KEY = 'lineframe-grid-frame-presets';
export const GRID_FRAME_INPUT_VERSION = 3;
export const MAX_GRID_FRAME_PRESETS = 20;
export const DEFAULT_STORY_HEIGHT = '3000';
export const DEFAULT_FOUNDATION_DEPTH = '1500';

// One entry per story-table section column; generateKey links each column to
// the checkbox that enables the corresponding generated elements.
const SECTION_COLUMNS = [
  { key: 'columnSection', target: 'member', type: 'column', generateKey: 'columns' },
  { key: 'beamSection', target: 'member', type: 'beam', generateKey: 'beams' },
  { key: 'floorSection', target: 'surface', type: 'floor', generateKey: 'floors' },
  { key: 'wallSection', target: 'surface', type: 'exteriorWall', generateKey: 'exteriorWalls' },
];
const GENERATE_KEYS = ['columns', 'beams', 'floors', 'exteriorWalls', 'foundation'];
// The foundation is a single level, so its sections live outside the per-story
// table in their own row.
const FOUNDATION_SECTION_FIELDS = [
  { key: 'columnSection', target: 'member', type: 'column', id: 'grid-frame-foundation-column-section' },
  { key: 'beamSection', target: 'member', type: 'beam', id: 'grid-frame-foundation-beam-section' },
];

function defaultFoundation() {
  return { depth: DEFAULT_FOUNDATION_DEPTH, columnSection: '', beamSection: '' };
}

function normalizeFoundation(foundation) {
  if (!foundation || typeof foundation !== 'object') return defaultFoundation();
  return {
    depth: typeof foundation.depth === 'string' ? foundation.depth : DEFAULT_FOUNDATION_DEPTH,
    columnSection: typeof foundation.columnSection === 'string' ? foundation.columnSection : '',
    beamSection: typeof foundation.beamSection === 'string' ? foundation.beamSection : '',
  };
}

function defaultStory() {
  return {
    height: DEFAULT_STORY_HEIGHT,
    columnSection: '',
    beamSection: '',
    floorSection: '',
    wallSection: '',
  };
}

function defaultInputValues() {
  return {
    version: GRID_FRAME_INPUT_VERSION,
    stories: [defaultStory()],
    spansX: '',
    spansY: '',
    generate: {
      columns: true,
      beams: true,
      floors: false,
      exteriorWalls: false,
      foundation: false,
    },
    foundation: defaultFoundation(),
  };
}

function normalizeStory(story) {
  if (!story || typeof story !== 'object') return defaultStory();
  return {
    height: typeof story.height === 'string' ? story.height : DEFAULT_STORY_HEIGHT,
    columnSection: typeof story.columnSection === 'string' ? story.columnSection : '',
    beamSection: typeof story.beamSection === 'string' ? story.beamSection : '',
    floorSection: typeof story.floorSection === 'string' ? story.floorSection : '',
    wallSection: typeof story.wallSection === 'string' ? story.wallSection : '',
  };
}

// Accepts the current (v3, per-story plus foundation) shape as well as the
// legacy v2 (per-story) and v1 (flat) ones. v1 is migrated by expanding its
// height list into one story per value and copying its model-wide sections
// onto every story; v2 simply gains the foundation defaults (disabled).
export function normalizeStoredInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (Array.isArray(value.stories)) {
    const stories = value.stories.slice(0, MAX_STORY_COUNT).map(normalizeStory);
    if (stories.length === 0) stories.push(defaultStory());
    const generate = value.generate && typeof value.generate === 'object' ? value.generate : {};
    return {
      version: GRID_FRAME_INPUT_VERSION,
      stories,
      spansX: typeof value.spansX === 'string' ? value.spansX : '',
      spansY: typeof value.spansY === 'string' ? value.spansY : '',
      generate: {
        columns: generate.columns !== false,
        beams: generate.beams !== false,
        floors: generate.floors === true,
        exteriorWalls: generate.exteriorWalls === true,
        foundation: generate.foundation === true,
      },
      foundation: normalizeFoundation(value.foundation),
    };
  }

  const columnSection = typeof value.columnSection === 'string' ? value.columnSection : '';
  const beamSection = typeof value.beamSection === 'string' ? value.beamSection : '';
  const parsed = parseMmList(
    typeof value.storyHeights === 'string' ? value.storyHeights : '',
    { maxCount: MAX_STORY_COUNT }
  );
  const heights = parsed.ok ? parsed.values.map(String) : [DEFAULT_STORY_HEIGHT];
  return {
    version: GRID_FRAME_INPUT_VERSION,
    stories: heights.map(height => ({
      height,
      columnSection,
      beamSection,
      floorSection: '',
      wallSection: '',
    })),
    spansX: typeof value.spansX === 'string' ? value.spansX : '',
    spansY: typeof value.spansY === 'string' ? value.spansY : '',
    generate: {
      columns: true,
      beams: true,
      floors: value.generateFloors === true,
      exteriorWalls: false,
      foundation: false,
    },
    foundation: defaultFoundation(),
  };
}

function readStoredInput() {
  try {
    const raw = globalThis.localStorage?.getItem(GRID_FRAME_INPUT_STORAGE_KEY);
    if (!raw) return null;
    return normalizeStoredInput(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
    return !!globalThis.localStorage;
  } catch {
    return false;
  }
}

function readPresets() {
  try {
    const raw = globalThis.localStorage?.getItem(GRID_FRAME_PRESETS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const presetsByName = new Map();
    for (const item of parsed) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      const values = normalizeStoredInput(item?.values);
      if (!name || !values) continue;
      presetsByName.set(name, { name, values });
    }
    return [...presetsByName.values()].slice(0, MAX_GRID_FRAME_PRESETS);
  } catch {
    return [];
  }
}

function hasNonDefaultLevels(levels) {
  if (!Array.isArray(levels)) return false;
  const defaults = createDefaultLevels();
  if (levels.length !== defaults.length) return true;
  const levelById = new Map(levels.map(level => [level.id, level]));
  return defaults.some(defaultLevel => {
    const level = levelById.get(defaultLevel.id);
    return !level || level.name !== defaultLevel.name || level.z !== defaultLevel.z;
  });
}

export function initGridFrameModal({
  state,
  history,
  onModelChange,
  syncSettingsControls,
  refreshLevelSelectors,
  hideSettingsModal = () => {},
  onModelLoaded = () => {
    syncSettingsControls();
    refreshLevelSelectors();
    onModelChange();
  },
}) {
  const modal = document.getElementById('grid-frame-modal');
  const form = document.getElementById('grid-frame-form');
  const settingsModal = document.getElementById('settings-modal');
  const presetSelect = document.getElementById('grid-frame-preset');
  const presetDeleteButton = document.getElementById('btn-grid-frame-preset-delete');
  const storyCountInput = document.getElementById('grid-frame-story-count');
  const storyBody = document.getElementById('grid-frame-story-body');
  const generateInputs = {
    columns: document.getElementById('grid-frame-generate-columns'),
    beams: document.getElementById('grid-frame-generate-beams'),
    floors: document.getElementById('grid-frame-generate-floors'),
    exteriorWalls: document.getElementById('grid-frame-generate-walls'),
    foundation: document.getElementById('grid-frame-generate-foundation'),
  };
  const foundationDepthInput = document.getElementById('grid-frame-foundation-depth');
  const foundationSelects = Object.fromEntries(
    FOUNDATION_SECTION_FIELDS.map(field => [field.key, document.getElementById(field.id)])
  );
  let returnFocusElement = null;
  let presets = readPresets();
  const spanFields = [
    {
      key: 'spansX',
      input: document.getElementById('grid-frame-spans-x'),
      labelKey: 'gridFrameSpansX',
      maxCount: MAX_SPAN_COUNT,
    },
    {
      key: 'spansY',
      input: document.getElementById('grid-frame-spans-y'),
      labelKey: 'gridFrameSpansY',
      maxCount: MAX_SPAN_COUNT,
    },
  ];
  // Bottom story first, matching the generator's stories order. The table
  // renders in reverse so the top story appears first, as on drawings.
  let stories = [];
  let foundation = defaultFoundation();
  let renderedRows = [];
  let bulkControls = null;
  let retainedValues = readStoredInput() || defaultInputValues();

  function listSections(target, type) {
    if (typeof state.listSections === 'function') {
      return state.listSections(target, type);
    }
    if (!Array.isArray(state.sectionCatalog)) return [];
    return state.sectionCatalog
      .filter(section => section?.target === target && section.type === type)
      .sort((a, b) => {
        if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
        return String(a.name).localeCompare(String(b.name));
      });
  }

  function populateSectionSelect(select, column, preferredName) {
    const sections = listSections(column.target, column.type);
    select.innerHTML = '';
    for (const section of sections) {
      const option = document.createElement('option');
      option.value = section.name;
      option.textContent = section.name;
      select.appendChild(option);
    }

    const names = new Set(sections.map(section => section.name));
    const defaultName = typeof state.getDefaultSectionName === 'function'
      ? state.getDefaultSectionName(column.target, column.type)
      : sections.find(section => section.isDefault)?.name;
    const selectedName = names.has(preferredName)
      ? preferredName
      : names.has(defaultName)
        ? defaultName
        : sections[0]?.name || '';
    select.value = selectedName;
    return selectedName;
  }

  // The bulk controls are one-shot applicators, not a mirror of the story
  // values: they reset to an empty sentinel after each apply so the same value
  // can be pushed again after individual rows were edited away from it.
  function populateBulkSectionSelect(select, column) {
    const sections = listSections(column.target, column.type);
    select.innerHTML = '';
    const sentinel = document.createElement('option');
    sentinel.value = '';
    sentinel.textContent = t('gridFrameBulkApply');
    select.appendChild(sentinel);
    for (const section of sections) {
      const option = document.createElement('option');
      option.value = section.name;
      option.textContent = section.name;
      select.appendChild(option);
    }
    select.value = '';
  }

  function storyLabel(storyIndex) {
    return `${storyIndex + 1}F`;
  }

  function markInputError(input) {
    input.classList.add('input-error');
    input.setAttribute('aria-invalid', 'true');
  }

  function clearOneInputError(input) {
    input.classList.remove('input-error');
    input.removeAttribute('aria-invalid');
  }

  function createStoryCell(child) {
    const cell = document.createElement('td');
    cell.appendChild(child);
    return cell;
  }

  function createBulkRow() {
    const row = document.createElement('tr');
    row.classList.add('grid-frame-bulk-row');
    const label = document.createElement('th');
    label.textContent = t('gridFrameBulkRow');
    label.setAttribute('scope', 'row');
    row.appendChild(label);

    const heightInput = document.createElement('input');
    heightInput.type = 'text';
    heightInput.setAttribute('inputmode', 'decimal');
    heightInput.setAttribute('autocomplete', 'off');
    heightInput.setAttribute('spellcheck', 'false');
    heightInput.setAttribute('aria-label', t('gridFrameBulkRow'));
    heightInput.placeholder = t('gridFrameBulkApply');
    heightInput.addEventListener('change', () => {
      const value = heightInput.value.trim();
      if (!value) return;
      for (const [storyIndex, story] of stories.entries()) {
        story.height = value;
        const rendered = renderedRows[storyIndex];
        if (rendered) {
          rendered.heightInput.value = value;
          clearOneInputError(rendered.heightInput);
        }
      }
      heightInput.value = '';
    });
    row.appendChild(createStoryCell(heightInput));

    const selects = {};
    for (const column of SECTION_COLUMNS) {
      const select = document.createElement('select');
      populateBulkSectionSelect(select, column);
      select.addEventListener('change', () => {
        const value = select.value;
        if (!value) return;
        for (const [storyIndex, story] of stories.entries()) {
          story[column.key] = value;
          const rendered = renderedRows[storyIndex];
          if (rendered) rendered.selects[column.key].value = value;
        }
        select.value = '';
      });
      selects[column.key] = select;
      row.appendChild(createStoryCell(select));
    }

    storyBody.appendChild(row);
    return { heightInput, selects };
  }

  function createStoryRow(storyIndex) {
    const story = stories[storyIndex];
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.textContent = storyLabel(storyIndex);
    label.setAttribute('scope', 'row');
    row.appendChild(label);

    const heightInput = document.createElement('input');
    heightInput.type = 'text';
    heightInput.setAttribute('inputmode', 'decimal');
    heightInput.setAttribute('autocomplete', 'off');
    heightInput.setAttribute('spellcheck', 'false');
    heightInput.setAttribute('aria-label', storyLabel(storyIndex));
    heightInput.value = story.height;
    heightInput.addEventListener('input', () => {
      story.height = heightInput.value;
      clearOneInputError(heightInput);
    });
    row.appendChild(createStoryCell(heightInput));

    const selects = {};
    for (const column of SECTION_COLUMNS) {
      const select = document.createElement('select');
      story[column.key] = populateSectionSelect(select, column, story[column.key]);
      select.addEventListener('change', () => {
        story[column.key] = select.value;
      });
      selects[column.key] = select;
      row.appendChild(createStoryCell(select));
    }

    renderedRows[storyIndex] = { heightInput, selects };
    return row;
  }

  function renderStoryTable() {
    storyBody.innerHTML = '';
    renderedRows = [];
    bulkControls = createBulkRow();
    for (let storyIndex = stories.length - 1; storyIndex >= 0; storyIndex--) {
      storyBody.appendChild(createStoryRow(storyIndex));
    }
    updateSectionColumnState();
  }

  function updateSectionColumnState() {
    for (const column of SECTION_COLUMNS) {
      const enabled = generateInputs[column.generateKey].checked;
      if (bulkControls) bulkControls.selects[column.key].disabled = !enabled;
      for (const rendered of renderedRows) {
        if (rendered) rendered.selects[column.key].disabled = !enabled;
      }
    }
  }

  function updateFoundationState() {
    const enabled = generateInputs.foundation.checked;
    foundationDepthInput.disabled = !enabled;
    for (const field of FOUNDATION_SECTION_FIELDS) {
      foundationSelects[field.key].disabled = !enabled;
    }
    if (!enabled) clearOneInputError(foundationDepthInput);
  }

  function renderFoundationRow() {
    foundationDepthInput.value = foundation.depth;
    for (const field of FOUNDATION_SECTION_FIELDS) {
      foundation[field.key] = populateSectionSelect(
        foundationSelects[field.key],
        field,
        foundation[field.key]
      );
    }
    updateFoundationState();
  }

  function clampStoryCount(value) {
    const count = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(count)) return stories.length || 1;
    return Math.min(MAX_STORY_COUNT, Math.max(1, count));
  }

  // Growing duplicates the current top story; shrinking removes stories from
  // the top so lower-story input is never lost by a miskeyed count.
  function setStoryCount(value) {
    const count = clampStoryCount(value);
    storyCountInput.value = String(count);
    if (count === stories.length) return;
    while (stories.length < count) {
      stories.push({ ...stories[stories.length - 1] });
    }
    stories.length = count;
    renderStoryTable();
  }

  function applyLanguage() {
    modal.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    modal.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    if (stories.length) renderStoryTable();
  }

  function captureInputValues() {
    return {
      version: GRID_FRAME_INPUT_VERSION,
      stories: stories.map(story => ({ ...story })),
      spansX: spanFields[0].input.value,
      spansY: spanFields[1].input.value,
      generate: Object.fromEntries(
        GENERATE_KEYS.map(key => [key, generateInputs[key].checked])
      ),
      foundation: { ...foundation },
    };
  }

  function retainInputValues() {
    if (stories.length) retainedValues = captureInputValues();
  }

  function applyInputValues(values) {
    const normalized = normalizeStoredInput(values) || defaultInputValues();
    stories = normalized.stories.map(story => ({ ...story }));
    foundation = { ...normalized.foundation };
    storyCountInput.value = String(stories.length);
    for (const field of spanFields) field.input.value = normalized[field.key];
    for (const key of GENERATE_KEYS) generateInputs[key].checked = normalized.generate[key];
    renderStoryTable();
    renderFoundationRow();
    // Capture back so retained/saved values hold the resolved section names.
    retainedValues = captureInputValues();
  }

  function refreshPresetSelect(preferredName = presetSelect.value) {
    presets = readPresets();
    presetSelect.innerHTML = '';
    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = t('gridFramePresetNone');
    emptyOption.dataset.i18n = 'gridFramePresetNone';
    presetSelect.appendChild(emptyOption);
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.name;
      option.textContent = preset.name;
      presetSelect.appendChild(option);
    }
    presetSelect.value = presets.some(preset => preset.name === preferredName)
      ? preferredName
      : '';
    presetDeleteButton.disabled = !presetSelect.value;
  }

  function clearInputErrors() {
    for (const field of spanFields) clearOneInputError(field.input);
    for (const rendered of renderedRows) {
      if (rendered) clearOneInputError(rendered.heightInput);
    }
    clearOneInputError(foundationDepthInput);
  }

  function show() {
    returnFocusElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    applyLanguage();
    refreshPresetSelect();
    applyInputValues(retainedValues);
    clearInputErrors();
    settingsModal?.setAttribute('inert', '');
    modal.classList.add('visible');
    modal.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => storyCountInput.focus());
  }

  function hide({ restoreFocus = true } = {}) {
    retainInputValues();
    clearInputErrors();
    modal.classList.remove('visible');
    modal.setAttribute('aria-hidden', 'true');
    settingsModal?.removeAttribute('inert');
    if (restoreFocus && returnFocusElement?.isConnected) {
      requestAnimationFrame(() => returnFocusElement.focus());
    }
  }

  // Shared by the story heights and the foundation depth: both are a single
  // millimetre value bounded by the generator's dimension limits.
  function parseMmValue(rawValue) {
    const raw = String(rawValue ?? '').trim();
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    if (value < MIN_GRID_DIMENSION_MM || value > MAX_GRID_DIMENSION_MM) return null;
    return value;
  }

  function parseInputs() {
    clearInputErrors();
    if (!generateInputs.columns.checked && !generateInputs.beams.checked) {
      showNotice(t('gridFrameNoMembers'), 'error');
      return null;
    }

    const parsedStories = [];
    for (const [storyIndex, story] of stories.entries()) {
      const height = parseMmValue(story.height);
      if (height === null) {
        const rendered = renderedRows[storyIndex];
        if (rendered) {
          markInputError(rendered.heightInput);
          rendered.heightInput.focus();
        }
        showNotice(t('gridFrameStoryHeightInvalid', { story: storyLabel(storyIndex) }), 'error');
        return null;
      }
      parsedStories.push({
        height,
        columnSection: story.columnSection,
        beamSection: story.beamSection,
        floorSection: story.floorSection,
        wallSection: story.wallSection,
      });
    }

    const parsed = { stories: parsedStories };
    for (const field of spanFields) {
      const result = parseMmList(field.input.value, { maxCount: field.maxCount });
      if (!result.ok) {
        markInputError(field.input);
        field.input.focus();
        const messageKey = PARSE_ERROR_KEYS[result.reason] || 'gridFrameInvalidInput';
        showNotice(t(messageKey, { field: t(field.labelKey) }), 'error');
        return null;
      }
      parsed[field.key] = result.values;
    }

    if (generateInputs.foundation.checked) {
      const depth = parseMmValue(foundation.depth);
      if (depth === null) {
        markInputError(foundationDepthInput);
        foundationDepthInput.focus();
        showNotice(t('gridFrameFoundationDepthInvalid'), 'error');
        return null;
      }
      parsed.foundation = {
        depth,
        columnSection: foundation.columnSection,
        beamSection: foundation.beamSection,
      };
    }
    return parsed;
  }

  function errorMessage(error) {
    if (error?.code === 'member-count') {
      return t('gridFrameTooLarge', { count: error.count, max: error.max });
    }
    if (error?.code === 'foundation-depth') return t('gridFrameFoundationDepthInvalid');
    return t('gridFrameGenerateFailed');
  }

  function generate() {
    retainInputValues();
    const values = parseInputs();
    if (!values) return;
    const inputValues = { ...retainedValues };

    // Build against a fresh AppState before touching the current model or its
    // history. Validation failures (including the member cap) must preserve an
    // existing redo stack.
    let generatedModel;
    try {
      generatedModel = buildGridFrame({
        ...values,
        generate: inputValues.generate,
        sectionCatalog: state.sectionCatalog,
        springCatalog: state.springCatalog,
      });
    } catch (error) {
      console.error('Grid frame generation failed:', error);
      showNotice(errorMessage(error), 'error', 6500);
      return;
    }

    // Nodes are intentionally excluded from autosave's broader content check,
    // but still count here because replacing the model discards them too.
    const hasModelContent =
      (state.nodes?.length || 0) > 0 ||
      hasNonDefaultLevels(state.levels) ||
      modelHasContent(state);
    if (hasModelContent && !window.confirm(t('gridFrameReplaceConfirm'))) return;

    let snapshotSaved = false;
    try {
      if (hasProvisionalEdit(state)) {
        throw new Error('Finish or cancel the current edit before generating a new model');
      }
      history.save();
      snapshotSaved = true;
      state.loadJSON(generatedModel);
      hide({ restoreFocus: false });
      hideSettingsModal();
      onModelLoaded();
      writeStorage(GRID_FRAME_INPUT_STORAGE_KEY, inputValues);
      requestAnimationFrame(() => document.getElementById('btn-settings')?.focus());

      // The foundation is the only level below GL, so it is always the lowest
      // one; its members are reported separately from the frame above.
      const foundationLevelId = inputValues.generate.foundation
        ? [...state.levels].sort((a, b) => a.z - b.z)[0]?.id
        : undefined;
      const tally = { columns: 0, beams: 0, foundationColumns: 0, foundationBeams: 0 };
      for (const member of state.members) {
        const isFoundation = foundationLevelId !== undefined
          && member.levelId === foundationLevelId;
        if (member.type === 'column') tally[isFoundation ? 'foundationColumns' : 'columns']++;
        else if (member.type === 'beam') tally[isFoundation ? 'foundationBeams' : 'beams']++;
      }
      const floors = state.surfaces?.filter(surface => surface.type === 'floor').length || 0;
      const walls = state.surfaces?.filter(surface => surface.type === 'exteriorWall').length || 0;
      showNotice(t('gridFrameDone', { ...tally, floors, walls }), 'success');
    } catch (error) {
      console.error('Grid frame generation failed:', error);
      if (snapshotSaved) history.undo();
      // The app-level History restore hook normally performs these updates.
      // Keep an explicit fallback for callers without that hook and for a
      // history.save()/undo() failure before a snapshot can be restored.
      syncSettingsControls();
      refreshLevelSelectors();
      onModelChange();
      showNotice(errorMessage(error), 'error', 6500);
    }
  }

  function savePreset() {
    retainInputValues();
    const proposedName = window.prompt(t('gridFramePresetNamePrompt'), presetSelect.value || '');
    if (proposedName === null) return;
    const name = proposedName.trim();
    if (!name) {
      showNotice(t('gridFramePresetNameRequired'), 'error');
      return;
    }

    const existingIndex = presets.findIndex(preset => preset.name === name);
    if (existingIndex < 0 && presets.length >= MAX_GRID_FRAME_PRESETS) {
      showNotice(t('gridFramePresetLimit', { max: MAX_GRID_FRAME_PRESETS }), 'error');
      return;
    }

    const nextPreset = { name, values: normalizeStoredInput(retainedValues) };
    const nextPresets = [...presets];
    if (existingIndex >= 0) nextPresets[existingIndex] = nextPreset;
    else nextPresets.push(nextPreset);
    if (!writeStorage(GRID_FRAME_PRESETS_STORAGE_KEY, nextPresets)) {
      showNotice(t('gridFramePresetSaveFailed'), 'error');
      return;
    }

    refreshPresetSelect(name);
    showNotice(t('gridFramePresetSaved', { name }), 'success');
  }

  function loadSelectedPreset() {
    presetDeleteButton.disabled = !presetSelect.value;
    const preset = presets.find(item => item.name === presetSelect.value);
    if (!preset) return;
    applyInputValues(preset.values);
    clearInputErrors();
    showNotice(t('gridFramePresetLoaded', { name: preset.name }), 'success');
  }

  function deletePreset() {
    const name = presetSelect.value;
    if (!name) return;
    if (!window.confirm(t('gridFramePresetDeleteConfirm', { name }))) return;
    const nextPresets = presets.filter(preset => preset.name !== name);
    if (!writeStorage(GRID_FRAME_PRESETS_STORAGE_KEY, nextPresets)) {
      showNotice(t('gridFramePresetDeleteFailed'), 'error');
      return;
    }
    refreshPresetSelect();
    showNotice(t('gridFramePresetDeleted', { name }), 'success');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    generate();
  });
  presetSelect.addEventListener('change', loadSelectedPreset);
  document.getElementById('btn-grid-frame-preset-save').addEventListener('click', savePreset);
  presetDeleteButton.addEventListener('click', deletePreset);
  document.getElementById('btn-grid-frame-close').addEventListener('click', hide);
  document.getElementById('btn-grid-frame-cancel').addEventListener('click', hide);
  storyCountInput.addEventListener('change', () => setStoryCount(storyCountInput.value));
  for (const key of GENERATE_KEYS) {
    generateInputs[key].addEventListener('change', () => {
      updateSectionColumnState();
      updateFoundationState();
    });
  }
  foundationDepthInput.addEventListener('input', () => {
    foundation.depth = foundationDepthInput.value;
    clearOneInputError(foundationDepthInput);
  });
  for (const field of FOUNDATION_SECTION_FIELDS) {
    const select = foundationSelects[field.key];
    select.addEventListener('change', () => {
      foundation[field.key] = select.value;
    });
  }
  modal.addEventListener('click', event => {
    if (event.target === modal) hide();
  });
  modal.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const focusable = [
      ...modal.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), select:not([disabled])'
      ),
    ]
      .filter(element => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  for (const field of spanFields) {
    field.input.addEventListener('input', () => clearOneInputError(field.input));
  }

  return {
    show,
    hide,
    applyLanguage,
    isOpen: () => modal.classList.contains('visible'),
  };
}
