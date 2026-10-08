import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readProjectFile = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('analysis export settings UI exposes mass factors and self-weight mode', async () => {
  const [html, appSource, modalSource] = await Promise.all([
    readProjectFile('index.html'),
    readProjectFile('js/app.js'),
    readProjectFile('js/analysis-settings-modal.js'),
  ]);

  for (const id of [
    'btn-analysis-settings',
    'analysis-settings-modal',
    'analysis-settings-form',
    'analysis-mass-source-list',
    'analysis-self-weight-mode',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(appSource, /initAnalysisSettingsModal/);
  assert.match(appSource, /state\.updateAnalysisSettings\(settings\)/);
  assert.match(modalSource, /LOAD_CASES\.map/);
  assert.match(modalSource, /massSources/);
});

test('user definition UI exposes material, section-property, and spring-stiffness inputs', async () => {
  const [html, source, css] = await Promise.all([
    readProjectFile('index.html'),
    Promise.all(['form', 'list', 'fields'].map(name => readProjectFile(`js/ui/user-def/${name}.js`))).then(parts => parts.join('\n')),
    readProjectFile('style.css'),
  ]);

  for (const id of [
    'user-def-section-material',
    'user-def-shape',
    'user-def-flange-thickness',
    'user-def-web-thickness',
    'user-def-box-thickness',
    'user-def-A',
    'user-def-Iy',
    'user-def-Iz',
    'user-def-J',
    'user-def-Avy',
    'user-def-Avz',
    'user-def-designation',
    'user-def-property-source',
    'user-def-thickness',
    'user-def-self-weight-mode',
    'user-def-additional-weight',
    'btn-user-def-calculate-properties',
    'user-def-shear-area-ratio-y',
    'user-def-shear-area-ratio-z',
    'user-def-kr',
    'user-def-krY',
    'user-def-krZ',
    'user-def-kt',
    'user-def-material-name',
    'user-def-E',
    'user-def-G',
    'user-def-density',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(source, /commands\.addMaterial/);
  assert.match(source, /commands\.updateMaterial/);
  assert.match(source, /commands\.updateSpring\(symbol, \{ \.\.\.stiffness, memo \}\)/);
  assert.match(source, /readSpringStiffnessInput/);
  assert.match(source, /patch\[property\] = result\.value/);
  assert.match(source, /calculateSectionPropertiesFromShape/);
  assert.match(source, /Math\.round\(value\)/);
  assert.match(html, /id="user-def-shear-area-ratio-y"[^>]*step="any"/);
  assert.match(html, /id="user-def-shear-area-ratio-z"[^>]*step="any"/);
  assert.match(css, /\[hidden\]\s*\{\s*display: none !important;/);
});
