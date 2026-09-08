import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installOfflineRoutes } from './offline.mjs';

const errors = new WeakMap();
test.beforeEach(async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  const list = [];
  errors.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('線材 0');
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

// Exercise only public UI controls and exported CAD, never window._app.
async function openCoordinates(page) {
  await page.locator('#coordinate-input > summary').click();
}
async function point(page, x, y) {
  const group = page.getByRole('group', { name: '座標で入力', exact: true });
  await group.getByLabel('X (mm)', { exact: true }).fill(String(x));
  await group.getByLabel('Y (mm)', { exact: true }).fill(String(y));
  await group.getByRole('button', { name: 'この座標を入力' }).click();
}
async function savedModel(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CAD保存', exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}
async function openList(page) {
  await page.getByRole('button', { name: 'モデル', exact: true }).click();
  await page.getByRole('button', { name: '要素一覧…', exact: true }).click();
  return page.getByRole('dialog', { name: '要素一覧', exact: true });
}

test('named controls create exact beams, columns, floors and undo without canvas coordinates', async ({ page }) => {
  await openCoordinates(page);
  await expect(page.locator('#btn-coordinate-finish')).toBeHidden();
  await point(page, 125.5, -250.25);
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 1');
  await point(page, 3250.5, 1750.25);
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('線材 1');
  const model = await savedModel(page);
  const member = model.members[0];
  expect(model.nodes.find(item => item.id === member.startNodeId)).toMatchObject({ x: 125.5, y: -250.25 });
  expect(model.nodes.find(item => item.id === member.endNodeId)).toMatchObject({ x: 3250.5, y: 1750.25 });
  await page.getByRole('button', { name: '柱', exact: true }).click();
  await point(page, 125.5, -250.25);
  await page.getByRole('button', { name: '床', exact: true }).click();
  await point(page, 0, 0);
  await point(page, 3000, 3000);
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toHaveText('線材 2 / 面材 1 / 荷重 0 / 支点 0');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('面材 0');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('面材 1');
});

test('coordinate validation and cancellation preserve model and redo history', async ({ page }) => {
  await openCoordinates(page);
  await point(page, 0, 0);
  await point(page, 3000, 0);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await point(page, 0, 1000);
  await point(page, 0, 1000);
  await expect(page.locator('#coordinate-result')).toContainText('変更はありません');
  await point(page, 1000000001, 0);
  expect(await page.locator('#coordinate-x').evaluate(input => input.validity.rangeOverflow)).toBe(true);
  await expect(page.locator('#coordinate-x')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#coordinate-result')).toContainText('範囲');
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('線材 0');
  await page.getByRole('button', { name: '未確定入力を取消' }).click();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('線材 1');
});

test('typed polygons close explicitly even when their last vertex is near the first', async ({ page }) => {
  await page.getByRole('button', { name: '床', exact: true }).click();
  await page.getByRole('combobox', { name: '形状', exact: true }).selectOption('polyline');
  await openCoordinates(page);
  for (const [x, y] of [[0, 0], [3000, 0], [3000, 3000], [20, 20]]) await point(page, x, y);
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 4');
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('面材 0');
  await page.getByRole('button', { name: '輪郭を確定', exact: true }).click();
  const model = await savedModel(page);
  expect(model.surfaces[0].points).toEqual([{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 20, y: 20 }]);
});

test('element list reveals a hidden member and named property fields edit it', async ({ page }) => {
  await openCoordinates(page);
  await point(page, 0, 0);
  await point(page, 3000, 0);
  const model = await savedModel(page);
  const id = model.members[0].id;
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '表示設定…', exact: true }).click();
  await page.getByRole('dialog', { name: '表示設定', exact: true }).getByLabel('線材', { exact: true }).uncheck();
  await page.getByRole('dialog', { name: '表示設定', exact: true }).getByRole('button', { name: '閉じる', exact: true }).click();
  const dialog = await openList(page);
  await dialog.getByLabel('ID・断面を検索').fill(id);
  await expect(dialog.getByRole('table')).toContainText('(3000, 0)');
  await dialog.getByRole('button', { name: id + ' を選択', exact: true }).click();
  await expect(page.locator('#selection-summary')).toContainText(id);
  await expect(page.locator('#placement-visibility-note')).toBeHidden();
  const endpoint = page.getByRole('group', { name: 'J端部 (終点)', exact: true });
  await endpoint.getByLabel('X (mm)', { exact: true }).fill('4500');
  await endpoint.getByLabel('X (mm)', { exact: true }).press('Tab');
  const after = await savedModel(page);
  expect(after.nodes.find(item => item.id === after.members[0].endNodeId).x).toBe(4500);
});

test('point loads and supports can be placed by labels, with repeated support input a no-op', async ({ page }) => {
  await openCoordinates(page);
  await page.getByRole('button', { name: '荷重', exact: true }).click();
  await page.getByRole('combobox', { name: '荷重種別', exact: true }).selectOption('pointLoad');
  await point(page, 750, 1250);
  await page.getByRole('button', { name: '支点', exact: true }).click();
  await point(page, 750, 1250);
  await point(page, 750, 1250);
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('荷重 1 / 支点 1');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('荷重 1 / 支点 0');
});

test('English names, view state and modal element filters are available to browser automation', async ({ page }) => {
  await page.getByRole('button', { name: /設定$/ }).click();
  const settings = page.getByRole('dialog', { name: '設定', exact: true });
  await settings.locator('#settings-lang').selectOption('en');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Plan Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '3D View', exact: true }).click();
  await expect(page.getByRole('button', { name: '3D View', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Beam', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Plan Input', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  await page.getByRole('button', { name: 'Element list…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Element list', exact: true });
  await expect(dialog.getByLabel('Element kind')).toBeVisible();
  await expect(dialog.getByText('No matching elements.', { exact: true })).toBeVisible();
});

test('element list paginates generated models, filters by level and handles empty search', async ({ page }) => {
  await page.getByRole('button', { name: 'モデル', exact: true }).click();
  await page.getByRole('group', { name: 'モデル', exact: true }).getByRole('button', { name: '初期モデル生成…', exact: true }).click();
  const generator = page.getByRole('dialog', { name: '初期モデル生成（格子フレーム）', exact: true });
  await generator.getByLabel('X方向スパンリスト (mm)', { exact: true }).fill('5@3000');
  await generator.getByLabel('Y方向スパンリスト (mm)', { exact: true }).fill('5@3000');
  await generator.getByRole('button', { name: '生成', exact: true }).click();
  await expect(generator).toBeHidden();
  const dialog = await openList(page);
  await expect(dialog.locator('tbody tr')).toHaveCount(50);
  const firstPageId = await dialog.locator('tbody button').first().textContent();
  await dialog.getByRole('button', { name: '次へ', exact: true }).click();
  expect(await dialog.locator('tbody button').first().textContent()).not.toBe(firstPageId);
  await dialog.getByRole('button', { name: '前へ', exact: true }).click();
  await expect(dialog.locator('tbody button').first()).toHaveText(firstPageId);
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('support');
  await expect(dialog.locator('tbody tr')).toHaveCount(36);
  await dialog.getByRole('combobox', { name: '階で絞り込み', exact: true }).selectOption({ index: 2 });
  await expect(dialog.getByText('該当する要素はありません。', { exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: '階で絞り込み', exact: true }).selectOption('all');
  await dialog.getByRole('searchbox', { name: 'ID・断面を検索', exact: true }).fill('does-not-exist');
  await expect(dialog.locator('tbody tr')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '次へ', exact: true })).toBeDisabled();
});

test('coordinate measurement is readable and selecting a tool clears pending input', async ({ page }) => {
  await openCoordinates(page);
  await point(page, 100, 200);
  await page.getByRole('button', { name: '計測', exact: true }).click();
  await expect(page.locator('#coordinate-state')).toContainText('未確定の点: 0');
  await point(page, 0, 0);
  await point(page, 3000, 4000);
  await expect(page.locator('#coordinate-state')).toContainText('距離 5000 mm');
  await page.getByRole('button', { name: '未確定入力を取消', exact: true }).click();
  await expect(page.locator('#coordinate-state')).not.toContainText('距離');
  await page.getByRole('button', { name: '選択', exact: true }).click();
  await expect(page.getByRole('button', { name: 'この座標を入力', exact: true })).toBeDisabled();
});
