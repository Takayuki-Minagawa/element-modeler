import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { MAX_GRID_FRAME_MEMBERS } from '../js/frame-generator.js';
import {
  DEFAULT_FOUNDATION_DEPTH,
  DEFAULT_STORY_HEIGHT,
  GRID_FRAME_INPUT_STORAGE_KEY,
  GRID_FRAME_INPUT_VERSION,
  GRID_FRAME_PRESETS_STORAGE_KEY,
  initGridFrameModal,
  MAX_GRID_FRAME_PRESETS,
  normalizeStoredInput,
} from '../js/grid-frame-modal.js';
import { AppState } from '../js/state.js';
import { ToolManager } from '../js/tools.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }
}

class FakeElement extends EventTarget {
  constructor(ownerDocument, id = '', tagName = 'DIV') {
    super();
    this.ownerDocument = ownerDocument;
    this.id = id;
    this.tagName = tagName;
    this.classList = new FakeClassList();
    this.dataset = {};
    this.children = [];
    this.attributes = new Map();
    this.textContent = '';
    this.value = '';
    this.placeholder = '';
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.isConnected = true;
    this.parentElement = null;
    this._innerHTML = '';
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    if (child.id) this.ownerDocument.elements.set(child.id, child);
    return child;
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    this.isConnected = false;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (value === '') this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  querySelectorAll(selector) {
    return this.ownerDocument.queries.get(`${this.id}:${selector}`) || [];
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }
}

function createFakeDocument() {
  const root = {
    elements: new Map(),
    queries: new Map(),
    activeElement: null,
    documentElement: {},
    getElementById(id) {
      return root.elements.get(id) || null;
    },
    createElement(tagName) {
      return new FakeElement(root, '', tagName.toUpperCase());
    },
  };
  root.body = new FakeElement(root, 'body', 'BODY');

  const elementTypes = {
    'grid-frame-form': 'FORM',
    'grid-frame-story-count': 'INPUT',
    'grid-frame-story-body': 'TBODY',
    'grid-frame-spans-x': 'INPUT',
    'grid-frame-spans-y': 'INPUT',
    'grid-frame-generate-columns': 'INPUT',
    'grid-frame-generate-beams': 'INPUT',
    'grid-frame-generate-floors': 'INPUT',
    'grid-frame-generate-walls': 'INPUT',
    'grid-frame-generate-foundation': 'INPUT',
    'grid-frame-foundation-depth': 'INPUT',
    'grid-frame-foundation-column-section': 'SELECT',
    'grid-frame-foundation-beam-section': 'SELECT',
    'grid-frame-preset': 'SELECT',
    'btn-grid-frame-preset-save': 'BUTTON',
    'btn-grid-frame-preset-delete': 'BUTTON',
    'btn-grid-frame-close': 'BUTTON',
    'btn-grid-frame-cancel': 'BUTTON',
    'btn-grid-frame-generate': 'BUTTON',
    'btn-grid-frame': 'BUTTON',
    'btn-settings': 'BUTTON',
  };
  for (const id of [
    'grid-frame-modal',
    'grid-frame-form',
    'grid-frame-story-count',
    'grid-frame-story-body',
    'grid-frame-spans-x',
    'grid-frame-spans-y',
    'grid-frame-generate-columns',
    'grid-frame-generate-beams',
    'grid-frame-generate-floors',
    'grid-frame-generate-walls',
    'grid-frame-generate-foundation',
    'grid-frame-foundation-depth',
    'grid-frame-foundation-column-section',
    'grid-frame-foundation-beam-section',
    'grid-frame-preset',
    'btn-grid-frame-preset-save',
    'btn-grid-frame-preset-delete',
    'btn-grid-frame-close',
    'btn-grid-frame-cancel',
    'btn-grid-frame-generate',
    'btn-grid-frame',
    'btn-settings',
    'settings-modal',
    'app-notice-host',
  ]) {
    root.elements.set(id, new FakeElement(root, id, elementTypes[id] || 'DIV'));
  }
  root.getElementById('grid-frame-generate-columns').checked = true;
  root.getElementById('grid-frame-generate-beams').checked = true;

  const inputs = [
    root.getElementById('grid-frame-spans-x'),
    root.getElementById('grid-frame-spans-y'),
  ];
  inputs[0].dataset.i18nPlaceholder = 'gridFrameSpansXPlaceholder';
  inputs[1].dataset.i18nPlaceholder = 'gridFrameSpansYPlaceholder';
  const localized = [
    root.getElementById('btn-grid-frame-close'),
    root.getElementById('btn-grid-frame-preset-save'),
    root.getElementById('btn-grid-frame-preset-delete'),
    root.getElementById('btn-grid-frame-cancel'),
    root.getElementById('btn-grid-frame-generate'),
  ];
  localized[0].dataset.i18n = 'helpClose';
  localized[1].dataset.i18n = 'gridFramePresetSave';
  localized[2].dataset.i18n = 'gridFramePresetDelete';
  localized[3].dataset.i18n = 'choiceCancel';
  localized[4].dataset.i18n = 'gridFrameGenerate';
  root.queries.set('grid-frame-modal:[data-i18n]', localized);
  root.queries.set('grid-frame-modal:[data-i18n-placeholder]', inputs);
  root.queries.set(
    'grid-frame-modal:button:not([disabled]), input:not([disabled]), select:not([disabled])', [
    localized[0],
    root.getElementById('grid-frame-preset'),
    localized[1],
    localized[2],
    root.getElementById('grid-frame-story-count'),
    ...inputs,
    localized[3],
    localized[4],
  ]
  );
  root.body.appendChild(root.getElementById('app-notice-host'));
  root.activeElement = root.getElementById('btn-grid-frame');

  let nextTimerId = 1;
  root.defaultView = {
    confirm: () => true,
    prompt: () => null,
    setTimeout: () => nextTimerId++,
    clearTimeout: () => {},
  };
  return root;
}

function createFakeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

async function withFakeBrowser(callback, { storage = createFakeStorage() } = {}) {
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    HTMLElement: globalThis.HTMLElement,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    localStorage: globalThis.localStorage,
  };
  const root = createFakeDocument();
  globalThis.document = root;
  globalThis.window = root.defaultView;
  globalThis.HTMLElement = FakeElement;
  globalThis.localStorage = storage;
  globalThis.requestAnimationFrame = callback => {
    callback();
    return 1;
  };
  try {
    return await callback(root);
  } finally {
    for (const [name, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[name];
      else globalThis[name] = value;
    }
  }
}

// The story table renders the bulk row first, then stories from the top story
// down to 1F. These helpers address rows by bottom-up story index (0 = 1F),
// matching the modal's internal ordering.
function rowControls(row) {
  return {
    label: row.children[0].textContent,
    height: row.children[1].children[0],
    columnSection: row.children[2].children[0],
    beamSection: row.children[3].children[0],
    floorSection: row.children[4].children[0],
    wallSection: row.children[5].children[0],
  };
}

function storyRowCount(root) {
  return root.getElementById('grid-frame-story-body').children.length - 1;
}

function storyRow(root, storyIndex) {
  const rows = root.getElementById('grid-frame-story-body').children;
  return rowControls(rows[rows.length - 1 - storyIndex]);
}

function bulkRow(root) {
  return rowControls(root.getElementById('grid-frame-story-body').children[0]);
}

function setStoryCount(root, count) {
  const input = root.getElementById('grid-frame-story-count');
  input.value = String(count);
  input.dispatchEvent(new Event('change'));
}

function setStoryHeights(root, heights) {
  setStoryCount(root, heights.length);
  heights.forEach((height, storyIndex) => {
    const input = storyRow(root, storyIndex).height;
    input.value = height;
    input.dispatchEvent(new Event('input'));
  });
}

function setValidInputs(root, heights = ['2800']) {
  setStoryHeights(root, heights);
  root.getElementById('grid-frame-spans-x').value = '4000';
  root.getElementById('grid-frame-spans-y').value = '5000';
}

function setCheckbox(root, id, checked) {
  const input = root.getElementById(id);
  input.checked = checked;
  input.dispatchEvent(new Event('change'));
}

function createCustomSectionState() {
  const state = new AppState();
  state.addSpring({ symbol: 'K-Test', memo: 'test column-end spring' });
  state.addSection({
    target: 'member',
    type: 'column',
    name: 'C-Test',
    b: 450,
    h: 450,
    defaultEndI: { condition: 'spring', springSymbol: 'K-Test' },
  });
  state.addSection({
    target: 'member',
    type: 'beam',
    name: 'B-Test',
    b: 300,
    h: 650,
  });
  state.addSection({
    target: 'surface',
    type: 'floor',
    name: 'S-Test',
  });
  state.addSection({
    target: 'surface',
    type: 'exteriorWall',
    name: 'OW-Test',
  });
  return state;
}

function initModal(root, overrides = {}) {
  return initGridFrameModal({
    state: { nodes: [], members: [] },
    history: { save() {}, undo() {} },
    onModelChange() {},
    syncSettingsControls() {},
    refreshLevelSelectors() {},
    ...overrides,
  });
}

function latestNotice(root) {
  return root.getElementById('app-notice-host').children.at(-1);
}

function dispatchSubmit(root) {
  const event = new Event('submit', { cancelable: true });
  root.getElementById('grid-frame-form').dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
}

test('initial grid frame modal exposes all inputs and actions', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  for (const id of [
    'btn-grid-frame',
    'grid-frame-modal',
    'grid-frame-form',
    'grid-frame-story-count',
    'grid-frame-story-body',
    'grid-frame-spans-x',
    'grid-frame-spans-y',
    'grid-frame-generate-columns',
    'grid-frame-generate-beams',
    'grid-frame-generate-floors',
    'grid-frame-generate-walls',
    'grid-frame-generate-foundation',
    'grid-frame-foundation-depth',
    'grid-frame-foundation-column-section',
    'grid-frame-foundation-beam-section',
    'grid-frame-preset',
    'btn-grid-frame-preset-save',
    'btn-grid-frame-preset-delete',
    'btn-grid-frame-close',
    'btn-grid-frame-cancel',
    'btn-grid-frame-generate',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(html, /data-i18n-placeholder="gridFrameSpansXPlaceholder"/);
  assert.match(html, /data-i18n-placeholder="gridFrameSpansYPlaceholder"/);
  for (const key of [
    'gridFrameStoryCount',
    'gridFrameGenerateItems',
    'gridFrameStoryTable',
    'gridFrameStory',
    'gridFrameStoryHeight',
    'gridFrameColumnSection',
    'gridFrameBeamSection',
    'gridFrameFloorSection',
    'gridFrameWallSection',
    'gridFrameGenerateFoundation',
    'gridFrameFoundation',
    'gridFrameFoundationDepth',
    'gridFrameFoundationColumnSection',
    'gridFrameFoundationBeamSection',
  ]) {
    assert.match(html, new RegExp(`data-i18n="${key}"`));
  }
  assert.match(html, /id="grid-frame-generate-columns"[^>]*checked/);
  assert.match(html, /id="grid-frame-generate-beams"[^>]*checked/);
});

test('grid frame modal builds one story row per story with 1F at the bottom', () =>
  withFakeBrowser(root => {
    const controller = initModal(root);
    controller.show();

    assert.equal(storyRowCount(root), 1);
    assert.equal(storyRow(root, 0).label, '1F');
    assert.equal(storyRow(root, 0).height.value, DEFAULT_STORY_HEIGHT);
    assert.equal(root.getElementById('grid-frame-story-count').value, '1');

    setStoryHeights(root, ['3500', '3000', '2800']);
    assert.equal(storyRowCount(root), 3);
    const rows = root.getElementById('grid-frame-story-body').children;
    assert.deepEqual(
      rows.slice(1).map(row => rowControls(row).label),
      ['3F', '2F', '1F']
    );
  })
);

test('changing the story count duplicates the top story and keeps lower stories', () =>
  withFakeBrowser(root => {
    const controller = initModal(root);
    controller.show();
    setStoryHeights(root, ['3500', '3000']);

    setStoryCount(root, 4);
    assert.equal(storyRowCount(root), 4);
    assert.equal(storyRow(root, 0).height.value, '3500');
    assert.equal(storyRow(root, 1).height.value, '3000');
    assert.equal(storyRow(root, 2).height.value, '3000');
    assert.equal(storyRow(root, 3).height.value, '3000');

    setStoryCount(root, 1);
    assert.equal(storyRowCount(root), 1);
    assert.equal(storyRow(root, 0).height.value, '3500');

    setStoryCount(root, 999);
    assert.equal(root.getElementById('grid-frame-story-count').value, '50');
    assert.equal(storyRowCount(root), 50);

    setStoryCount(root, 'abc');
    assert.equal(root.getElementById('grid-frame-story-count').value, '50');
    assert.equal(storyRowCount(root), 50);
  })
);

test('bulk row applies its height and section choices to every story', () =>
  withFakeBrowser(root => {
    const state = createCustomSectionState();
    const controller = initModal(root, { state });
    controller.show();
    setStoryHeights(root, ['3500', '3000']);

    const bulk = bulkRow(root);
    bulk.height.value = '4200';
    bulk.height.dispatchEvent(new Event('change'));
    assert.equal(storyRow(root, 0).height.value, '4200');
    assert.equal(storyRow(root, 1).height.value, '4200');

    bulk.columnSection.value = 'C-Test';
    bulk.columnSection.dispatchEvent(new Event('change'));
    bulk.wallSection.value = 'OW-Test';
    bulk.wallSection.dispatchEvent(new Event('change'));
    assert.equal(storyRow(root, 0).columnSection.value, 'C-Test');
    assert.equal(storyRow(root, 1).columnSection.value, 'C-Test');
    assert.equal(storyRow(root, 0).wallSection.value, 'OW-Test');
    assert.equal(storyRow(root, 1).wallSection.value, 'OW-Test');

    // Bulk fields are one-shot applicators and clear themselves afterwards.
    assert.equal(bulk.height.value, '');
    assert.equal(bulk.columnSection.value, '');
    assert.equal(bulk.wallSection.value, '');
  })
);

test('bulk row can re-apply the same value after a story was changed', () =>
  withFakeBrowser(root => {
    const state = createCustomSectionState();
    const controller = initModal(root, { state });
    controller.show();
    setStoryHeights(root, ['3000', '3000']);

    const bulk = bulkRow(root);
    bulk.height.value = '4200';
    bulk.height.dispatchEvent(new Event('change'));
    bulk.columnSection.value = 'C-Test';
    bulk.columnSection.dispatchEvent(new Event('change'));

    // Edit 1F away from the bulk values, then push the same values again.
    const firstStory = storyRow(root, 0);
    firstStory.height.value = '2500';
    firstStory.height.dispatchEvent(new Event('input'));
    firstStory.columnSection.value = '_C';
    firstStory.columnSection.dispatchEvent(new Event('change'));

    bulk.height.value = '4200';
    bulk.height.dispatchEvent(new Event('change'));
    bulk.columnSection.value = 'C-Test';
    bulk.columnSection.dispatchEvent(new Event('change'));

    assert.equal(storyRow(root, 0).height.value, '4200');
    assert.equal(storyRow(root, 1).height.value, '4200');
    assert.equal(storyRow(root, 0).columnSection.value, 'C-Test');
    assert.equal(storyRow(root, 1).columnSection.value, 'C-Test');
  })
);

test('bulk row ignores its empty sentinel value', () =>
  withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();
    setStoryHeights(root, ['3000', '3200']);

    const bulk = bulkRow(root);
    assert.equal(bulk.height.value, '');
    assert.equal(bulk.columnSection.value, '');
    const before = storyRow(root, 0).columnSection.value;

    bulk.height.dispatchEvent(new Event('change'));
    bulk.columnSection.dispatchEvent(new Event('change'));

    assert.equal(storyRow(root, 0).height.value, '3000');
    assert.equal(storyRow(root, 1).height.value, '3200');
    assert.equal(storyRow(root, 0).columnSection.value, before);
  })
);

test('generate checkboxes enable and disable their section columns', () =>
  withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();
    setStoryHeights(root, ['3000', '3000']);

    assert.equal(storyRow(root, 0).floorSection.disabled, true);
    assert.equal(storyRow(root, 0).wallSection.disabled, true);
    assert.equal(bulkRow(root).floorSection.disabled, true);
    assert.equal(storyRow(root, 0).columnSection.disabled, false);
    assert.equal(storyRow(root, 0).beamSection.disabled, false);

    setCheckbox(root, 'grid-frame-generate-floors', true);
    assert.equal(storyRow(root, 0).floorSection.disabled, false);
    assert.equal(storyRow(root, 1).floorSection.disabled, false);
    assert.equal(bulkRow(root).floorSection.disabled, false);

    setCheckbox(root, 'grid-frame-generate-columns', false);
    assert.equal(storyRow(root, 0).columnSection.disabled, true);
    assert.equal(bulkRow(root).columnSection.disabled, true);
  })
);

test('grid frame modal rejects generation with both columns and beams disabled', () =>
  withFakeBrowser(root => {
    let saveCalls = 0;
    const controller = initModal(root, {
      history: { save() { saveCalls++; }, undo() {} },
    });
    controller.show();
    setValidInputs(root);
    root.getElementById('grid-frame-generate-columns').checked = false;
    root.getElementById('grid-frame-generate-beams').checked = false;
    dispatchSubmit(root);

    assert.equal(saveCalls, 0);
    assert.equal(controller.isOpen(), true);
    assert.match(latestNotice(root).textContent, /柱|梁/);
  })
);

test('grid frame modal retains input and restores focus after cancellation', () =>
  withFakeBrowser(root => {
    const controller = initModal(root);

    controller.show();
    assert.equal(root.activeElement, root.getElementById('grid-frame-story-count'));
    setValidInputs(root, ['2800', '3000']);
    root.getElementById('btn-grid-frame-cancel').dispatchEvent(new Event('click'));

    assert.equal(controller.isOpen(), false);
    assert.equal(root.getElementById('settings-modal').getAttribute('inert'), null);
    assert.equal(root.activeElement, root.getElementById('btn-grid-frame'));

    controller.show();
    assert.equal(storyRowCount(root), 2);
    assert.equal(storyRow(root, 0).height.value, '2800');
    assert.equal(storyRow(root, 1).height.value, '3000');
    assert.equal(root.getElementById('grid-frame-spans-x').value, '4000');
    assert.equal(root.getElementById('grid-frame-spans-y').value, '5000');
  })
);

test('grid frame modal keeps invalid story heights open and does not touch history', () =>
  withFakeBrowser(root => {
    let saveCalls = 0;
    let loadCalls = 0;
    const controller = initModal(root, {
      state: { nodes: [], members: [], loadJSON() { loadCalls++; } },
      history: { save() { saveCalls++; }, undo() {} },
    });

    controller.show();
    setValidInputs(root, ['0']);
    dispatchSubmit(root);

    const input = storyRow(root, 0).height;
    assert.equal(controller.isOpen(), true);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(root.activeElement, input);
    assert.equal(saveCalls, 0);
    assert.equal(loadCalls, 0);
    assert.match(latestNotice(root).textContent, /1F/);
    assert.match(latestNotice(root).textContent, /1〜100,000 mm/);
  })
);

test('grid frame modal reports invalid span lists per field', () =>
  withFakeBrowser(root => {
    let saveCalls = 0;
    const controller = initModal(root, {
      history: { save() { saveCalls++; }, undo() {} },
    });

    controller.show();
    setStoryHeights(root, ['2800']);
    root.getElementById('grid-frame-spans-x').value = 'nope';
    root.getElementById('grid-frame-spans-y').value = '5000';
    dispatchSubmit(root);

    const input = root.getElementById('grid-frame-spans-x');
    assert.equal(controller.isOpen(), true);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    assert.equal(root.activeElement, input);
    assert.equal(saveCalls, 0);
  })
);

test('grid frame modal respects replacement cancellation', () =>
  withFakeBrowser(root => {
    let confirmCalls = 0;
    let saveCalls = 0;
    let loadCalls = 0;
    root.defaultView.confirm = () => {
      confirmCalls++;
      return false;
    };
    const controller = initModal(root, {
      state: { nodes: [{ id: 1 }], members: [], loadJSON() { loadCalls++; } },
      history: { save() { saveCalls++; }, undo() {} },
    });

    controller.show();
    setValidInputs(root);
    dispatchSubmit(root);

    assert.equal(confirmCalls, 1);
    assert.equal(saveCalls, 0);
    assert.equal(loadCalls, 0);
    assert.equal(controller.isOpen(), true);
    assert.equal(localStorage.getItem(GRID_FRAME_INPUT_STORAGE_KEY), null);
  })
);

test('grid frame modal confirms before replacing independent model content', async () => {
  const contentCases = [
    { loads: [{ id: 'LD1' }] },
    { supports: [{ id: 'SUP1' }] },
    { axes: [{ id: 'AX1' }] },
    { underlay: { name: 'plan.dxf', entities: [{ type: 'LINE' }] } },
    {
      levels: [
        { id: 'L0', name: 'GL', z: 0 },
        { id: 'L1', name: '2F', z: 2800 },
        { id: 'L2', name: 'RF', z: 6000 },
      ],
    },
  ];

  for (const content of contentCases) {
    await withFakeBrowser(root => {
      let confirmCalls = 0;
      let saveCalls = 0;
      let loadCalls = 0;
      root.defaultView.confirm = () => {
        confirmCalls++;
        return false;
      };
      const controller = initModal(root, {
        state: {
          nodes: [],
          members: [],
          surfaces: [],
          ...content,
          loadJSON() { loadCalls++; },
        },
        history: { save() { saveCalls++; }, undo() {} },
      });

      controller.show();
      setValidInputs(root);
      dispatchSubmit(root);

      assert.equal(confirmCalls, 1);
      assert.equal(saveCalls, 0);
      assert.equal(loadCalls, 0);
      assert.equal(controller.isOpen(), true);
    });
  }
});

test('grid frame modal replaces the model and synchronizes the UI', () =>
  withFakeBrowser(root => {
    const state = new AppState();
    const calls = { save: 0, sync: 0, refresh: 0, change: 0, hideSettings: 0 };
    const controller = initModal(root, {
      state,
      history: { save() { calls.save++; }, undo() { return true; } },
      onModelChange() { calls.change++; },
      syncSettingsControls() { calls.sync++; },
      refreshLevelSelectors() { calls.refresh++; },
      hideSettingsModal() { calls.hideSettings++; },
    });

    controller.show();
    setValidInputs(root);
    dispatchSubmit(root);

    assert.deepEqual(calls, { save: 1, sync: 1, refresh: 1, change: 1, hideSettings: 1 });
    assert.equal(state.members.filter(member => member.type === 'column').length, 4);
    assert.equal(state.members.filter(member => member.type === 'beam').length, 4);
    assert.equal(controller.isOpen(), false);
    assert.equal(root.activeElement, root.getElementById('btn-settings'));
    assert.match(latestNotice(root).textContent, /柱 4本・梁 4本/);
    assert.equal(latestNotice(root).getAttribute('role'), 'status');
  })
);

test('grid frame modal applies per-story sections, generates surfaces, and restores saved input', async () => {
  const storage = createFakeStorage();

  await withFakeBrowser(root => {
    const state = createCustomSectionState();
    const controller = initModal(root, {
      state,
      history: { save() {}, undo() { return true; } },
    });

    controller.show();
    assert.ok(
      storyRow(root, 0).columnSection.children.some(option => option.value === 'C-Test')
    );
    assert.ok(
      storyRow(root, 0).beamSection.children.some(option => option.value === 'B-Test')
    );

    setValidInputs(root, ['2800', '3000']);
    setCheckbox(root, 'grid-frame-generate-floors', true);
    setCheckbox(root, 'grid-frame-generate-walls', true);
    for (const storyIndex of [0, 1]) {
      const row = storyRow(root, storyIndex);
      row.columnSection.value = 'C-Test';
      row.columnSection.dispatchEvent(new Event('change'));
      row.beamSection.value = 'B-Test';
      row.beamSection.dispatchEvent(new Event('change'));
      row.floorSection.value = 'S-Test';
      row.floorSection.dispatchEvent(new Event('change'));
      row.wallSection.value = 'OW-Test';
      row.wallSection.dispatchEvent(new Event('change'));
    }
    dispatchSubmit(root);

    assert.equal(
      state.members.filter(member => member.type === 'column')
        .every(member => member.sectionName === 'C-Test'),
      true
    );
    assert.equal(
      state.members.filter(member => member.type === 'column')
        .every(member => member.endI.springSymbol === 'K-Test'),
      true
    );
    assert.equal(
      state.members.filter(member => member.type === 'beam')
        .every(member => member.sectionName === 'B-Test'),
      true
    );
    const floors = state.surfaces.filter(surface => surface.type === 'floor');
    const walls = state.surfaces.filter(surface => surface.type === 'exteriorWall');
    assert.equal(floors.length, 2);
    assert.ok(floors.every(surface => surface.sectionName === 'S-Test'));
    assert.equal(walls.length, 2);
    assert.ok(walls.every(surface => surface.sectionName === 'OW-Test'));
    assert.match(latestNotice(root).textContent, /床 2枚/);
    assert.match(latestNotice(root).textContent, /外壁 2枚/);

    assert.deepEqual(JSON.parse(storage.getItem(GRID_FRAME_INPUT_STORAGE_KEY)), {
      version: GRID_FRAME_INPUT_VERSION,
      stories: [
        {
          height: '2800',
          columnSection: 'C-Test',
          beamSection: 'B-Test',
          floorSection: 'S-Test',
          wallSection: 'OW-Test',
        },
        {
          height: '3000',
          columnSection: 'C-Test',
          beamSection: 'B-Test',
          floorSection: 'S-Test',
          wallSection: 'OW-Test',
        },
      ],
      spansX: '4000',
      spansY: '5000',
      generate: {
        columns: true,
        beams: true,
        floors: true,
        exteriorWalls: true,
        foundation: false,
      },
      foundation: { depth: DEFAULT_FOUNDATION_DEPTH, columnSection: '_C', beamSection: '_G' },
    });
  }, { storage });

  await withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();

    assert.equal(storyRowCount(root), 2);
    assert.equal(storyRow(root, 0).height.value, '2800');
    assert.equal(storyRow(root, 1).height.value, '3000');
    assert.equal(storyRow(root, 1).columnSection.value, 'C-Test');
    assert.equal(storyRow(root, 1).beamSection.value, 'B-Test');
    assert.equal(storyRow(root, 1).floorSection.value, 'S-Test');
    assert.equal(storyRow(root, 1).wallSection.value, 'OW-Test');
    assert.equal(root.getElementById('grid-frame-spans-x').value, '4000');
    assert.equal(root.getElementById('grid-frame-generate-floors').checked, true);
    assert.equal(root.getElementById('grid-frame-generate-walls').checked, true);
  }, { storage });
});

test('grid frame modal migrates legacy v1 stored input to per-story values', () => {
  const storage = createFakeStorage({
    [GRID_FRAME_INPUT_STORAGE_KEY]: JSON.stringify({
      storyHeights: '2800, 2@3000',
      spansX: '6000',
      spansY: '5000',
      columnSection: 'C-Test',
      beamSection: 'B-Test',
      generateFloors: true,
    }),
  });

  return withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();

    assert.equal(storyRowCount(root), 3);
    assert.equal(storyRow(root, 0).height.value, '2800');
    assert.equal(storyRow(root, 1).height.value, '3000');
    assert.equal(storyRow(root, 2).height.value, '3000');
    for (const storyIndex of [0, 1, 2]) {
      assert.equal(storyRow(root, storyIndex).columnSection.value, 'C-Test');
      assert.equal(storyRow(root, storyIndex).beamSection.value, 'B-Test');
    }
    assert.equal(root.getElementById('grid-frame-spans-x').value, '6000');
    assert.equal(root.getElementById('grid-frame-spans-y').value, '5000');
    assert.equal(root.getElementById('grid-frame-generate-columns').checked, true);
    assert.equal(root.getElementById('grid-frame-generate-beams').checked, true);
    assert.equal(root.getElementById('grid-frame-generate-floors').checked, true);
    assert.equal(root.getElementById('grid-frame-generate-walls').checked, false);
  }, { storage });
});

test('normalizeStoredInput migrates v1 shapes and rejects non-objects', () => {
  assert.equal(normalizeStoredInput(null), null);
  assert.equal(normalizeStoredInput('text'), null);
  assert.equal(normalizeStoredInput([1, 2]), null);

  const migrated = normalizeStoredInput({
    storyHeights: '3500, 3000',
    spansX: '6000',
    spansY: '5000',
    columnSection: 'C1',
    beamSection: 'G1',
    generateFloors: true,
  });
  assert.deepEqual(migrated, {
    version: 3,
    stories: [
      { height: '3500', columnSection: 'C1', beamSection: 'G1', floorSection: '', wallSection: '' },
      { height: '3000', columnSection: 'C1', beamSection: 'G1', floorSection: '', wallSection: '' },
    ],
    spansX: '6000',
    spansY: '5000',
    generate: {
      columns: true,
      beams: true,
      floors: true,
      exteriorWalls: false,
      foundation: false,
    },
    foundation: { depth: DEFAULT_FOUNDATION_DEPTH, columnSection: '', beamSection: '' },
  });

  const fallback = normalizeStoredInput({ storyHeights: 'broken' });
  assert.equal(fallback.stories.length, 1);
  assert.equal(fallback.stories[0].height, DEFAULT_STORY_HEIGHT);

  const roundTrip = normalizeStoredInput(migrated);
  assert.deepEqual(roundTrip, migrated);
});

test('grid frame modal saves, loads, and deletes named presets', () => {
  const storage = createFakeStorage();
  return withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();
    setValidInputs(root, ['3000', '3000']);
    const row = storyRow(root, 0);
    row.columnSection.value = 'C-Test';
    row.columnSection.dispatchEvent(new Event('change'));
    setCheckbox(root, 'grid-frame-generate-floors', true);
    root.defaultView.prompt = () => 'Office';

    root.getElementById('btn-grid-frame-preset-save').dispatchEvent(new Event('click'));

    const saved = JSON.parse(storage.getItem(GRID_FRAME_PRESETS_STORAGE_KEY));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].name, 'Office');
    assert.equal(saved[0].values.version, GRID_FRAME_INPUT_VERSION);
    assert.equal(saved[0].values.stories.length, 2);
    assert.equal(saved[0].values.stories[0].columnSection, 'C-Test');
    assert.equal(saved[0].values.generate.floors, true);
    assert.match(latestNotice(root).textContent, /Office/);

    setValidInputs(root, ['4200']);
    setCheckbox(root, 'grid-frame-generate-floors', false);
    const presetSelect = root.getElementById('grid-frame-preset');
    presetSelect.value = 'Office';
    presetSelect.dispatchEvent(new Event('change'));

    assert.equal(storyRowCount(root), 2);
    assert.equal(storyRow(root, 0).height.value, '3000');
    assert.equal(storyRow(root, 0).columnSection.value, 'C-Test');
    assert.equal(root.getElementById('grid-frame-generate-floors').checked, true);
    assert.equal(root.getElementById('btn-grid-frame-preset-delete').disabled, false);

    let confirmMessage = '';
    root.defaultView.confirm = message => {
      confirmMessage = message;
      return true;
    };
    root.getElementById('btn-grid-frame-preset-delete').dispatchEvent(new Event('click'));

    assert.match(confirmMessage, /Office/);
    assert.deepEqual(JSON.parse(storage.getItem(GRID_FRAME_PRESETS_STORAGE_KEY)), []);
    assert.equal(presetSelect.value, '');
    assert.equal(root.getElementById('btn-grid-frame-preset-delete').disabled, true);
    assert.match(latestNotice(root).textContent, /Office/);
  }, { storage });
});

test('grid frame modal limits presets and ignores corrupted storage JSON', async () => {
  const values = {
    storyHeights: '3000',
    spansX: '6000',
    spansY: '6000',
    columnSection: '',
    beamSection: '',
    generateFloors: false,
  };
  const presets = Array.from({ length: MAX_GRID_FRAME_PRESETS }, (_, index) => ({
    name: `Preset ${index + 1}`,
    values,
  }));
  const fullStorage = createFakeStorage({
    [GRID_FRAME_PRESETS_STORAGE_KEY]: JSON.stringify(presets),
  });

  await withFakeBrowser(root => {
    const controller = initModal(root, { state: new AppState() });
    controller.show();
    root.defaultView.prompt = () => 'One too many';
    root.getElementById('btn-grid-frame-preset-save').dispatchEvent(new Event('click'));

    assert.equal(
      JSON.parse(fullStorage.getItem(GRID_FRAME_PRESETS_STORAGE_KEY)).length,
      MAX_GRID_FRAME_PRESETS
    );
    assert.match(latestNotice(root).textContent, new RegExp(String(MAX_GRID_FRAME_PRESETS)));
  }, { storage: fullStorage });

  const corruptedStorage = createFakeStorage({
    [GRID_FRAME_INPUT_STORAGE_KEY]: '{broken input',
    [GRID_FRAME_PRESETS_STORAGE_KEY]: '[broken presets',
  });
  await withFakeBrowser(root => {
    const controller = initModal(root, { state: new AppState() });
    assert.doesNotThrow(() => controller.show());
    assert.equal(storyRowCount(root), 1);
    assert.equal(storyRow(root, 0).height.value, DEFAULT_STORY_HEIGHT);
    assert.equal(root.getElementById('grid-frame-generate-floors').checked, false);
    assert.equal(root.getElementById('grid-frame-preset').children.length, 1);
  }, { storage: corruptedStorage });
});

test('grid frame modal reports projected and maximum member counts before saving', () =>
  withFakeBrowser(root => {
    let saveCalls = 0;
    const controller = initModal(root, {
      history: { save() { saveCalls++; }, undo() {} },
    });
    const spans = Array(12).fill('6000').join(',');
    const projectedMembers = 50 * ((13 * 13) + (12 * 13) + (12 * 13));

    controller.show();
    setStoryHeights(root, Array(50).fill('3000'));
    root.getElementById('grid-frame-spans-x').value = spans;
    root.getElementById('grid-frame-spans-y').value = spans;
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      dispatchSubmit(root);
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(saveCalls, 0);
    assert.equal(controller.isOpen(), true);
    assert.match(latestNotice(root).textContent, new RegExp(String(projectedMembers)));
    assert.match(latestNotice(root).textContent, new RegExp(String(MAX_GRID_FRAME_MEMBERS)));
  })
);

test('grid frame modal rolls back and resynchronizes after a load failure', () =>
  withFakeBrowser(root => {
    const calls = { save: 0, undo: 0, sync: 0, refresh: 0, change: 0 };
    const controller = initModal(root, {
      state: {
        nodes: [],
        members: [],
        loadJSON() { throw new Error('load failed'); },
      },
      history: {
        save() { calls.save++; },
        undo() { calls.undo++; return true; },
      },
      onModelChange() { calls.change++; },
      syncSettingsControls() { calls.sync++; },
      refreshLevelSelectors() { calls.refresh++; },
    });

    controller.show();
    setValidInputs(root);
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      dispatchSubmit(root);
    } finally {
      console.error = originalConsoleError;
    }

    assert.deepEqual(calls, { save: 1, undo: 1, sync: 1, refresh: 1, change: 1 });
    assert.equal(controller.isOpen(), true);
    assert.match(latestNotice(root).textContent, /生成に失敗/);
    assert.equal(localStorage.getItem(GRID_FRAME_INPUT_STORAGE_KEY), null);
  })
);

test('app wires the grid frame modal and ignores Escape while IME is composing', async () => {
  const source = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');

  assert.match(source, /import \{ initGridFrameModal \} from '\.\/grid-frame-modal\.js'/);
  assert.match(source, /const gridFrameModal = initGridFrameModal\(\{/);
  assert.match(source, /document\.getElementById\('btn-grid-frame'\).*gridFrameModal\.show/);
  assert.match(source, /if \(e\.isComposing\) return;\s*if \(e\.key === 'Escape'\)/);
});

test('in-app help documents generated and excluded model elements', async () => {
  const source = await readFile(new URL('../js/help-content.js', import.meta.url), 'utf8');

  assert.match(source, /初期モデル生成（格子フレーム）/);
  assert.match(source, /最下レベルの並進3方向を拘束した支点/);
  assert.match(source, /「床」「外壁」「基礎」チェックは既定で OFF/);
  assert.match(source, /「一括」行/);
  assert.match(source, /荷重・ブレースは生成されません/);
  assert.match(source, /Initial Model Generation \(Grid Frame\)/);
  assert.match(source, /supports restrained in DX\/DY\/DZ on the lowest level/);
  assert.match(source, /The "Floors", "Exterior walls", and "Foundation" checkboxes are OFF by default/);
  assert.match(source, /Loads and braces are not generated/);
});

test('text-field undo and redo remain native while the grid modal is being edited', () => {
  let undoCalls = 0;
  let redoCalls = 0;
  let updateCalls = 0;
  let preventDefaultCalls = 0;
  const manager = Object.create(ToolManager.prototype);
  Object.assign(manager, {
    state: { currentTool: 'member' },
    canvas2d: { preview: null, measure: null },
    history: {
      undo() { undoCalls++; return true; },
      redo() { redoCalls++; return true; },
    },
    onUpdate() { updateCalls++; },
  });
  const event = (key, shiftKey = false) => ({
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: true,
    metaKey: false,
    shiftKey,
    target: { tagName: 'INPUT', isContentEditable: false },
    preventDefault() { preventDefaultCalls++; },
  });

  manager._onKeyDown(event('z'));
  manager._onKeyDown(event('y'));
  manager._onKeyDown(event('z', true));

  assert.equal(undoCalls, 0);
  assert.equal(redoCalls, 0);
  assert.equal(updateCalls, 0);
  assert.equal(preventDefaultCalls, 0);

  manager._onKeyDown({
    ...event('z'),
    target: { tagName: 'BODY', isContentEditable: false },
  });
  assert.equal(undoCalls, 1);
  assert.equal(updateCalls, 1);
  assert.equal(preventDefaultCalls, 1);
});

test('text-field spaces and Enter are not captured by canvas shortcuts', () => {
  let preventDefaultCalls = 0;
  let finishPolylineCalls = 0;
  const manager = Object.create(ToolManager.prototype);
  Object.assign(manager, {
    state: { currentTool: 'surface', surfaceDraftMode: 'polyline' },
    _spaceDown: false,
    _finishSurfacePolyline() { finishPolylineCalls++; },
  });
  const inputTarget = { tagName: 'INPUT', isContentEditable: false };

  manager._onKeyDown({
    key: ' ',
    code: 'Space',
    target: inputTarget,
    preventDefault() { preventDefaultCalls++; },
  });
  manager._onKeyDown({
    key: 'Enter',
    code: 'Enter',
    target: inputTarget,
    preventDefault() { preventDefaultCalls++; },
  });

  assert.equal(manager._spaceDown, false);
  assert.equal(finishPolylineCalls, 0);
  assert.equal(preventDefaultCalls, 0);

  manager._onKeyDown({
    key: ' ',
    code: 'Space',
    target: { tagName: 'BODY', isContentEditable: false },
    preventDefault() { preventDefaultCalls++; },
  });
  manager._onKeyDown({
    key: 'Enter',
    code: 'Enter',
    target: { tagName: 'BODY', isContentEditable: false },
    preventDefault() { preventDefaultCalls++; },
  });

  assert.equal(manager._spaceDown, true);
  assert.equal(finishPolylineCalls, 1);
  assert.equal(preventDefaultCalls, 1);
});

function foundationControls(root) {
  return {
    checkbox: root.getElementById('grid-frame-generate-foundation'),
    depth: root.getElementById('grid-frame-foundation-depth'),
    columnSection: root.getElementById('grid-frame-foundation-column-section'),
    beamSection: root.getElementById('grid-frame-foundation-beam-section'),
  };
}

test('foundation controls start disabled and follow their checkbox', () =>
  withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();

    const foundation = foundationControls(root);
    assert.equal(foundation.checkbox.checked, false);
    assert.equal(foundation.depth.value, DEFAULT_FOUNDATION_DEPTH);
    for (const control of [foundation.depth, foundation.columnSection, foundation.beamSection]) {
      assert.equal(control.disabled, true);
    }
    // The section selects are filled from the model catalog either way.
    assert.ok(foundation.columnSection.children.some(option => option.value === 'C-Test'));
    assert.ok(foundation.beamSection.children.some(option => option.value === 'B-Test'));

    setCheckbox(root, 'grid-frame-generate-foundation', true);
    for (const control of [foundation.depth, foundation.columnSection, foundation.beamSection]) {
      assert.equal(control.disabled, false);
    }

    setCheckbox(root, 'grid-frame-generate-foundation', false);
    assert.equal(foundation.depth.disabled, true);
  })
);

test('grid frame modal generates the foundation and reports its counts', () =>
  withFakeBrowser(root => {
    const state = createCustomSectionState();
    const controller = initModal(root, {
      state,
      history: { save() {}, undo() { return true; } },
    });
    controller.show();

    setValidInputs(root, ['3000', '3000']);
    setCheckbox(root, 'grid-frame-generate-foundation', true);
    const foundation = foundationControls(root);
    foundation.depth.value = '1800';
    foundation.depth.dispatchEvent(new Event('input'));
    foundation.columnSection.value = 'C-Test';
    foundation.columnSection.dispatchEvent(new Event('change'));
    foundation.beamSection.value = 'B-Test';
    foundation.beamSection.dispatchEvent(new Event('change'));
    dispatchSubmit(root);

    const foundationLevel = state.levels.find(level => level.name === 'FDN');
    assert.ok(foundationLevel);
    assert.equal(foundationLevel.z, -1800);
    const foundationMembers = state.members.filter(
      member => member.levelId === foundationLevel.id
    );
    assert.equal(foundationMembers.filter(member => member.type === 'column').length, 4);
    assert.equal(foundationMembers.filter(member => member.type === 'beam').length, 4);
    assert.ok(foundationMembers.every(member => ['C-Test', 'B-Test'].includes(member.sectionName)));
    assert.ok(state.supports.every(support => support.levelId === foundationLevel.id));

    // Foundation members are reported apart from the frame above GL.
    const notice = latestNotice(root).textContent;
    assert.match(notice, /柱 8本/);
    assert.match(notice, /梁 8本/);
    assert.match(notice, /基礎柱 4本/);
    assert.match(notice, /地中梁 4本/);
  })
);

test('an invalid foundation depth blocks generation and is ignored while off', () =>
  withFakeBrowser(root => {
    let generated = 0;
    const state = createCustomSectionState();
    const controller = initModal(root, {
      state,
      history: { save() { generated++; }, undo() { return true; } },
    });
    controller.show();

    setValidInputs(root, ['3000']);
    setCheckbox(root, 'grid-frame-generate-foundation', true);
    const foundation = foundationControls(root);
    foundation.depth.value = '0';
    foundation.depth.dispatchEvent(new Event('input'));
    dispatchSubmit(root);

    assert.equal(generated, 0);
    assert.equal(foundation.depth.getAttribute('aria-invalid'), 'true');
    assert.match(latestNotice(root).textContent, /根入れ深さ/);

    // Turning the foundation off must not keep the bad value blocking the form.
    setCheckbox(root, 'grid-frame-generate-foundation', false);
    assert.equal(foundation.depth.getAttribute('aria-invalid'), null);
    dispatchSubmit(root);
    assert.equal(generated, 1);
    assert.equal(state.levels.some(level => level.name === 'FDN'), false);
  })
);

test('foundation input round-trips through storage and presets', async () => {
  const storage = createFakeStorage();

  await withFakeBrowser(root => {
    const controller = initModal(root, {
      state: createCustomSectionState(),
      history: { save() {}, undo() { return true; } },
    });
    controller.show();
    setValidInputs(root, ['3000']);
    setCheckbox(root, 'grid-frame-generate-foundation', true);
    const foundation = foundationControls(root);
    foundation.depth.value = '2100';
    foundation.depth.dispatchEvent(new Event('input'));
    foundation.beamSection.value = 'B-Test';
    foundation.beamSection.dispatchEvent(new Event('change'));
    dispatchSubmit(root);

    const saved = JSON.parse(storage.getItem(GRID_FRAME_INPUT_STORAGE_KEY));
    assert.equal(saved.version, GRID_FRAME_INPUT_VERSION);
    assert.equal(saved.generate.foundation, true);
    assert.deepEqual(saved.foundation, {
      depth: '2100',
      columnSection: '_C',
      beamSection: 'B-Test',
    });
  }, { storage });

  await withFakeBrowser(root => {
    const controller = initModal(root, { state: createCustomSectionState() });
    controller.show();

    const foundation = foundationControls(root);
    assert.equal(foundation.checkbox.checked, true);
    assert.equal(foundation.depth.value, '2100');
    assert.equal(foundation.beamSection.value, 'B-Test');
    assert.equal(foundation.depth.disabled, false);
  }, { storage });
});

test('v2 stored input gains the foundation defaults', () => {
  const migrated = normalizeStoredInput({
    version: 2,
    stories: [{ height: '3000', columnSection: 'C1', beamSection: 'G1' }],
    spansX: '6000',
    spansY: '5000',
    generate: { columns: true, beams: true, floors: true, exteriorWalls: true },
  });

  assert.equal(migrated.version, GRID_FRAME_INPUT_VERSION);
  assert.equal(migrated.generate.foundation, false);
  assert.deepEqual(migrated.foundation, {
    depth: DEFAULT_FOUNDATION_DEPTH,
    columnSection: '',
    beamSection: '',
  });
  assert.deepEqual(normalizeStoredInput(migrated), migrated);
});
