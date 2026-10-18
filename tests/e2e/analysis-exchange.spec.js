import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AppState } from '../../js/state.js';
import { installOfflineRoutes } from './offline.mjs';

const original = {
  schema_version: '1', units: { length: 'm', force: 'N', time: 's' },
  model: {
    name: 'coincident-spring-nodes', ndm: 2, ndf: 3,
    nodes: [{ tag: 1, x: 0, y: 0, z: 0 }, { tag: 101, x: 0, y: 0, z: 0 }, { tag: 2, x: 3, y: 0, z: 0 }],
    supports: [{ node_tag: 1, fixity: [true, true, true] }],
    elements: [
      { type: 'zeroLengthSpring2D', tag: 11, node_i: 1, node_j: 101, kx: 0, ky: 200000, kr: 0 },
      { type: 'elasticBeamColumn2D', tag: 12, node_i: 101, node_j: 2, area: 0.1, elastic_modulus: 1e10, inertia: 0.001 },
    ],
    constraints: [{ kind: 'equalDOF', slave_node_tag: 101, slave_dof: 1, terms: [{ node_tag: 1, dof: 1, coefficient: 1 }] }],
    groups: { frame: { nodes: [1, 101, 2], elements: [11, 12] } },
  },
  load_cases: [
    { name: 'G', element_loads: [{ type: 'beamUniform', element_tag: 12, wy: -1000, wx: 0, wz: 0 }] },
    { name: 'Q_residential', nodal_loads: [{ node_tag: 2, fx: 0, fy: -1300, mz: 0 }] },
    { name: 'E+', nodal_loads: [{ node_tag: 2, fx: 100, fy: 0, mz: 0 }] },
  ],
  load_combinations: [{ name: 'custom-signed', factors: { G: 1, Q_residential: 0.7, 'E+': -1 } }],
  metadata: { preserved: { note: '<b>original</b>', array: [1, false, null] } },
};
function cadFixture() {
  const state = new AppState();
  const a = state.addNode(0, 0), b = state.addNode(3000, 0);
  state.addMember(a.id, b.id);
  return state.toJSON();
}
const upload = (page, selector, data) => page.locator(selector).setInputFiles({
  name: 'analysis-exchange-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
});
const open = async page => {
  await page.locator('#menu-analysis-trigger').click();
  await page.locator('#btn-analysis-exchange').click();
};
const close = page => page.locator('#btn-exchange-close').click();
const current = page => expect(page.locator('#analysis-exchange-binding')).toHaveText('関連付け時点のCADと一致しています。');
async function download(page, click) {
  const pending = page.waitForEvent('download');
  await click();
  return JSON.parse(await readFile(await (await pending).path(), 'utf8'));
}

const errors = new WeakMap();
test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const list = []; errors.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window._app));
  await upload(page, '#file-import', cadFixture());
  await expect(page.locator('#model-summary')).toContainText('線材 1');
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('native solver JSON survives CAD download/reload and exports with coincident nodes and signed combinations', async ({ page }) => {
  await open(page);
  await upload(page, '#analysis-exchange-file', original);
  await current(page);
  await expect(page.locator('#analysis-exchange-summary')).toContainText('fem-struct-pygo-v1');
  await expect(page.locator('#btn-exchange-native')).toBeEnabled();
  expect(await download(page, () => page.locator('#btn-exchange-native').click())).toEqual(original);
  await close(page);
  const saved = await download(page, () => page.getByRole('button', { name: 'CAD保存', exact: true }).click());
  expect(saved.schemaVersion).toBe(16);
  expect(saved.analysisExchange.model).toEqual(original);
  const oldCad = cadFixture(); oldCad.schemaVersion = 15; delete oldCad.analysisExchange;
  await upload(page, '#file-import', oldCad);
  await open(page);
  await expect(page.locator('#analysis-exchange-binding')).toHaveText('解析原本はまだ関連付けられていません。');
  await expect(page.locator('#btn-exchange-native')).toBeDisabled();
  await close(page);
  await upload(page, '#file-import', saved);
  await open(page); await current(page);
  expect(await download(page, () => page.locator('#btn-exchange-native').click())).toEqual(original);
});

test('CAD edits block native export; archive import stays stale and Undo restores the prior association', async ({ page }) => {
  await open(page);
  await upload(page, '#analysis-exchange-file', original); await current(page);
  const archive = await download(page, () => page.locator('#btn-exchange-save').click());
  await close(page);
  await page.evaluate(() => {
    const { state, history, update } = window._app;
    history.transact(() => state.updateNode(state.nodes[1].id, { x: 4000 })); update();
  });
  await open(page);
  await expect(page.locator('#analysis-exchange-binding')).toContainText('一致しません');
  await expect(page.locator('#btn-exchange-native')).toBeDisabled();
  await expect(page.locator('#btn-exchange-save')).toBeEnabled();
  expect(await download(page, () => page.locator('#btn-exchange-save').click())).toEqual(archive);
  await upload(page, '#analysis-exchange-file', archive);
  await expect(page.locator('#analysis-exchange-notice')).toContainText('関連保存しました');
  await expect(page.locator('#analysis-exchange-binding')).toContainText('一致しません');
  await expect(page.locator('#btn-exchange-native')).toBeDisabled();
  await close(page);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await open(page); await current(page);
  await page.locator('#btn-exchange-detach').click();
  await expect(page.locator('#analysis-exchange-binding')).toHaveText('解析原本はまだ関連付けられていません。');
  await close(page);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await open(page); await current(page);
  expect(await download(page, () => page.locator('#btn-exchange-native').click())).toEqual(original);
});

test('invalid import is reported without replacing the current solver original', async ({ page }) => {
  await open(page);
  await upload(page, '#analysis-exchange-file', original); await current(page);
  const before = await page.evaluate(() => window._app.history.undoStack.length);
  const invalid = structuredClone(original); invalid.model.elements[0].node_j = 999;
  await upload(page, '#analysis-exchange-file', invalid);
  await expect(page.locator('#analysis-exchange-notice')).toContainText('処理できません');
  await current(page);
  expect(await page.evaluate(() => window._app.history.undoStack.length)).toBe(before);
  expect(await download(page, () => page.locator('#btn-exchange-native').click())).toEqual(original);
});
