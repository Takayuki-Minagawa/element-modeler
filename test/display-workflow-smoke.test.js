import { toolHarness } from './helpers/ui-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('display workflow controls are exposed in the toolbar and property panel', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const sidePanelsSource = await readFile(new URL('../js/side-panels.js', import.meta.url), 'utf8');

  for (const id of [
    'toolbar-resizer',
    'btn-toggle-toolbar',
    'sel-display-preset',
    'chk-plan-layer-selection-lock',
    'sel-3d-layer-display-mode',
    'sel-beam-3d-section-mode',
    'chk-show-members',
    'chk-show-surfaces',
    'chk-show-loads',
    'chk-show-member-end-symbols',
    'chk-show-placement-labels',
    'sel-member-type-filter',
    'sel-section-filter',
    'sel-copy-source-layer',
    'sel-copy-target-layer',
    'btn-copy-level',
    'btn-model-check',
    'model-check-content',
    'property-resizer',
    'btn-toggle-property',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }

  assert.match(css, /grid-template-columns:\s*var\(--toolbar-w\)\s+var\(--side-resizer-w\)\s+minmax\(0,\s*1fr\)\s+var\(--side-resizer-w\)\s+var\(--panel-w\)/);
  assert.match(css, /body\.toolbar-collapsed/);
  assert.match(css, /body\.property-collapsed/);
  assert.match(sidePanelsSource, /lineframe-toolbar-width/);
  assert.match(sidePanelsSource, /lineframe-property-panel-width/);
  assert.match(sidePanelsSource, /pointermove/);
  assert.match(sidePanelsSource, /pointercancel/);
  assert.match(sidePanelsSource, /layoutRefreshQueued/);
  assert.match(sidePanelsSource, /applyPanelWidth\(side,\s*nextWidth,\s*false\)/);
  assert.match(appSource, /canvas2d\.resize\(\)/);
});

test('selection tools ignore hidden or locked members and surfaces', () => {
  const { manager, state } = toolHarness();
  const a = state.addNode(0, 0), b = state.addNode(1000, 0);
  const member = state.addMember(a.id, b.id, { levelId: 'L1' });
  const surface = state.addSurfaceRect(0, 0, 1000, 1000, { levelId: 'L1' });
  state.settings.planLayerDisplayMode = 'halftone';
  state.settings.planLayerSelectionLock = true;
  assert.equal(manager._findSelectableMemberAt(500, 0, 10), null);
  assert.equal(manager._findSelectableSurfaceAt(500, 500), null);
  state.activeLevelId = 'L1';
  assert.equal(manager._findSelectableMemberAt(500, 0, 10).id, member.id);
  assert.equal(manager._findSelectableSurfaceAt(500, 500).id, surface.id);
  state.settings.showMembers = false;
  assert.equal(manager._findSelectableMemberAt(500, 0, 10), null);
});

test('3D viewer uses 3D layer display and element filters', async () => {
  const viewerSource = await readFile(new URL('../js/viewer3d.js', import.meta.url), 'utf8');

  assert.match(viewerSource, /isSurfaceVisible\(s,\s*'3d'\)/);
  assert.match(viewerSource, /isMemberVisible\(m,\s*'3d'\)/);
  assert.match(viewerSource, /getPlanLayerStyle\(m\.levelId,\s*\{\s*view:\s*'3d'\s*\}\)/);
  // Wall surface opacity (0.35) is applied through a named constant and scaled
  // by the per-layer alpha (opacityMultiplier).
  assert.match(viewerSource, /wall:\s*0\.35/);
  assert.match(viewerSource, /SURFACE_OPACITY\.wall \* opacityMultiplier/);
  assert.match(viewerSource, /_addBeamHSection3D/);
  assert.match(viewerSource, /beam3dSectionMode/);
});
