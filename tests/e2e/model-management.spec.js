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

async function savedModel(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CAD保存', exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

async function openManagement(page, name, menu = 'モデル') {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  return page.getByRole('dialog', { name, exact: true });
}

async function closeManagement(dialog) {
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('level rename undo and redo refresh the input level selector and reopened management dialog', async ({ page }) => {
  const before = await savedModel(page);
  const original = before.levels[0];
  let dialog = await openManagement(page, 'レイヤー管理');
  const row = dialog.locator('.layer-row').filter({ hasText: original.id });
  await row.getByRole('textbox').fill('基準<GL>&階');
  await row.getByRole('textbox').press('Tab');
  await closeManagement(dialog);
  await expect(page.locator('#sel-active-layer option:checked')).toContainText('基準<GL>&階');
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  await expect(page.locator('#sel-active-layer option:checked')).toContainText(original.name);
  expect((await savedModel(page)).levels).toEqual(before.levels);
  dialog = await openManagement(page, 'レイヤー管理');
  await expect(dialog.locator('.layer-row').filter({ hasText: original.id }).getByRole('textbox')).toHaveValue(original.name);
  await closeManagement(dialog);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  await expect(page.locator('#sel-active-layer option:checked')).toContainText('基準<GL>&階');
  expect((await savedModel(page)).levels.find(level => level.id === original.id).name).toBe('基準<GL>&階');
  dialog = await openManagement(page, 'レイヤー管理');
  await expect(dialog.locator('.layer-row').filter({ hasText: original.id }).getByRole('textbox')).toHaveValue('基準<GL>&階');
});

test('axis addition and coordinate edit have separate undo entries and reopen with restored values', async ({ page }) => {
  const before = await savedModel(page);
  let dialog = await openManagement(page, '通り芯管理');
  await dialog.getByRole('button', { name: /X通りを追加/ }).click();
  await closeManagement(dialog);
  const added = await savedModel(page);
  expect(added.axes).toHaveLength(before.axes.length + 1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savedModel(page)).axes).toEqual(before.axes);
  dialog = await openManagement(page, '通り芯管理');
  await expect(dialog.locator('.layer-row')).toHaveCount(before.axes.length);
  await closeManagement(dialog);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  expect((await savedModel(page)).axes).toEqual(added.axes);
  dialog = await openManagement(page, '通り芯管理');
  const coordinate = dialog.locator('.layer-row').last().getByRole('spinbutton');
  await coordinate.fill('3500');
  await coordinate.press('Tab');
  await closeManagement(dialog);
  const edited = await savedModel(page);
  expect(edited.axes.at(-1).coord).toBe(3500);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savedModel(page)).axes).toEqual(added.axes);
  dialog = await openManagement(page, '通り芯管理');
  await expect(dialog.locator('.layer-row').last().getByRole('spinbutton')).toHaveValue(String(added.axes.at(-1).coord));
  await closeManagement(dialog);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  expect((await savedModel(page)).axes).toEqual(edited.axes);
});

test('load combination factor undo updates reopened fields and rejected blank input preserves redo', async ({ page }) => {
  const before = await savedModel(page);
  let dialog = await openManagement(page, '荷重組合せ', '解析');
  // The first numeric cell belongs to DL, following the visible column header.
  const factor = dialog.locator('.layer-row').first().getByRole('spinbutton').first();
  await factor.fill('2.25');
  await factor.press('Tab');
  await closeManagement(dialog);
  const edited = await savedModel(page);
  expect(edited.loadCombinations[0].factors.DL).toBe(2.25);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savedModel(page)).loadCombinations).toEqual(before.loadCombinations);
  dialog = await openManagement(page, '荷重組合せ', '解析');
  const restored = dialog.locator('.layer-row').first().getByRole('spinbutton').first();
  await expect(restored).toHaveValue(String(before.loadCombinations[0].factors.DL));
  await restored.fill('');
  await restored.press('Tab');
  await expect(restored).toHaveValue(String(before.loadCombinations[0].factors.DL));
  await closeManagement(dialog);
  await expect(page.getByRole('button', { name: 'やり直す', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'やり直す', exact: true }).click();
  expect((await savedModel(page)).loadCombinations).toEqual(edited.loadCombinations);
  dialog = await openManagement(page, '荷重組合せ', '解析');
  await expect(dialog.locator('.layer-row').first().getByRole('spinbutton').first()).toHaveValue('2.25');
});
