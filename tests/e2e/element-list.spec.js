import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { AppState } from '../../js/state.js';
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

// Exercise public controls and downloaded CAD, including selection side effects.
async function savedModel(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CAD保存', exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}

async function importModel(page, model) {
  await page.locator('#file-import').setInputFiles({
    name: 'element-list.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(model)),
  });
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText(`線材 ${model.members.length}`);
}

async function openList(page, english = false) {
  await page.getByRole('button', { name: english ? 'Model' : 'モデル', exact: true }).click();
  await page.getByRole('button', { name: english ? 'Element list…' : '要素一覧…', exact: true }).click();
  return page.getByRole('dialog', { name: english ? 'Element list' : '要素一覧', exact: true });
}

function twoLevelModel() {
  const state = new AppState();
  for (const [index, level] of state.levels.entries()) {
    const start = state.addNode(0, index * 4000);
    const end = state.addNode(3000, index * 4000);
    state.addMember(start.id, end.id, { type: 'beam', levelId: level.id });
  }
  return state.toJSON();
}

test('filtered bulk selection includes every page, replaces selection, and supports batch delete and undo', async ({ page }) => {
  await page.getByRole('button', { name: 'モデル', exact: true }).click();
  await page.getByRole('group', { name: 'モデル', exact: true }).getByRole('button', { name: '初期モデル生成…', exact: true }).click();
  const generator = page.getByRole('dialog', { name: '初期モデル生成（格子フレーム）', exact: true });
  await generator.getByLabel('階数', { exact: true }).fill('2');
  await generator.getByLabel('階数', { exact: true }).press('Tab');
  await generator.getByLabel('X方向スパンリスト (mm)', { exact: true }).fill('5@3000');
  await generator.getByLabel('Y方向スパンリスト (mm)', { exact: true }).fill('5@3000');
  await generator.getByRole('button', { name: '生成', exact: true }).click();
  await expect(generator).toBeHidden();
  const before = await savedModel(page);
  const beam = before.members.find(member => member.type === 'beam');
  const targetLevel = before.levels.find(level => level.id === beam.levelId);
  const matches = before.members.filter(member => member.type === 'beam' && member.levelId === beam.levelId && member.sectionName === beam.sectionName);
  expect(matches.length).toBeGreaterThan(50);
  const excluded = before.members.find(member => member.type === 'column');

  let dialog = await openList(page);
  await dialog.getByRole('searchbox', { name: 'ID・断面を検索', exact: true }).fill(String(excluded.id));
  await dialog.getByRole('button', { name: `${excluded.id} を選択`, exact: true }).click();
  await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${excluded.id}`);

  dialog = await openList(page);
  await dialog.getByRole('searchbox', { name: 'ID・断面を検索', exact: true }).fill('');
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
  await dialog.getByRole('combobox', { name: '線材種別で絞り込み', exact: true }).selectOption('beam');
  await dialog.getByRole('combobox', { name: '断面で絞り込み', exact: true }).selectOption(beam.sectionName);
  await dialog.getByRole('combobox', { name: '階で絞り込み', exact: true }).selectOption({ label: `${targetLevel.name} / Z ${targetLevel.z} mm` });
  await expect(dialog.locator('tbody tr')).toHaveCount(50);
  await dialog.getByRole('button', { name: '次へ', exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(matches.length - 50);
  await dialog.getByRole('button', { name: `検索結果の線材 ${matches.length} 件を一括選択`, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${matches.map(member => member.id).join(', ')}`);
  await expect(page.getByRole('button', { name: '平面入力', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '選択部材を削除', exact: true }).click();
  const selectedIds = new Set(matches.map(member => member.id));
  expect((await savedModel(page)).members).toEqual(before.members.filter(member => !selectedIds.has(member.id)));
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savedModel(page)).members).toEqual(before.members);
});

test('bulk selection reveals hidden members across levels and activates the plan inspector', async ({ page }) => {
  const model = twoLevelModel();
  await importModel(page, model);
  await page.getByRole('button', { name: '表示', exact: true }).click();
  await page.getByRole('button', { name: '表示設定…', exact: true }).click();
  const display = page.getByRole('dialog', { name: '表示設定', exact: true });
  await display.getByLabel('線材', { exact: true }).uncheck();
  await display.getByRole('combobox', { name: '線材種別フィルタ', exact: true }).selectOption('column');
  await display.getByRole('combobox', { name: '2Dレイヤー表示', exact: true }).selectOption('current');
  await display.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: '3D 表示', exact: true }).click();
  const dialog = await openList(page);
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
  await dialog.getByRole('button', { name: `検索結果の線材 ${model.members.length} 件を一括選択`, exact: true }).click();
  await expect(page.getByRole('button', { name: '平面入力', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '選択部材を削除', exact: true })).toBeVisible();
  await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${model.members.map(member => member.id).join(', ')}`);
  const after = await savedModel(page);
  expect(after.members).toEqual(model.members);
  expect(after.settings).toMatchObject({ showMembers: true, memberTypeFilter: 'all', sectionFilter: 'all', planLayerDisplayMode: 'all' });
});

test('member filters are scoped to members and an empty result disables bulk selection in both languages', async ({ page }) => {
  const model = twoLevelModel();
  await importModel(page, model);
  let dialog = await openList(page);
  await expect(dialog.locator('#element-member-filters')).toBeHidden();
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
  await expect(dialog.getByRole('combobox', { name: '線材種別で絞り込み', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: '断面で絞り込み', exact: true })).toBeVisible();
  await dialog.getByRole('combobox', { name: '線材種別で絞り込み', exact: true }).selectOption('column');
  await expect(dialog.getByRole('button', { name: '検索結果の線材 0 件を一括選択', exact: true })).toBeDisabled();
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('all');
  await expect(dialog.locator('#element-member-filters')).toBeHidden();
  await expect(dialog.locator('tbody tr')).toHaveCount(model.members.length);
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
  await dialog.getByRole('combobox', { name: '線材種別で絞り込み', exact: true }).selectOption('all');
  await dialog.getByLabel('ID・断面を検索', { exact: true }).fill('does-not-exist');
  await expect(dialog.getByRole('button', { name: '検索結果の線材 0 件を一括選択', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: /設定$/ }).click();
  await page.getByRole('dialog', { name: '設定', exact: true }).locator('#settings-lang').selectOption('en');
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  dialog = await openList(page, true);
  await expect(dialog.getByText('No matching elements.', { exact: true })).toBeVisible();
  await expect(dialog.locator('#element-select-members')).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Select all 0 matching members', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('combobox', { name: 'Filter by member type', exact: true })).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Filter by section', exact: true })).toBeVisible();
});

test('imported numeric member and level IDs retain their type through filtering and row selection', async ({ page }) => {
  const model = twoLevelModel();
  const levelIds = new Map(model.levels.map((level, index) => [level.id, index + 1]));
  model.levels.forEach(level => { level.id = levelIds.get(level.id); });
  model.members.forEach((member, index) => {
    member.id = index + 7;
    member.levelId = levelIds.get(member.levelId);
    if (member.topLevelId != null) member.topLevelId = levelIds.get(member.topLevelId);
  });
  await importModel(page, model);
  const dialog = await openList(page);
  await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
  const level = model.levels[0];
  await dialog.getByRole('combobox', { name: '階で絞り込み', exact: true }).selectOption({ label: `${level.name} / Z ${level.z} mm` });
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await dialog.getByRole('button', { name: '7 を選択', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#selection-summary')).toHaveText('選択中: 7');
  const endpoint = page.getByRole('group', { name: 'J端部 (終点)', exact: true });
  await endpoint.getByLabel('X (mm)', { exact: true }).fill('4500');
  await endpoint.getByLabel('X (mm)', { exact: true }).press('Tab');
  const after = await savedModel(page);
  expect(after.members[0]).toMatchObject({ id: 7, levelId: 1 });
  expect(after.nodes.find(node => node.id === after.members[0].endNodeId).x).toBe(4500);
  expect(after.nodes.find(node => node.id === after.members[1].endNodeId).x).toBe(3000);
});

test('horizontal and vertical braces each filter and select using their persisted member type', async ({ page }) => {
  const state = new AppState();
  for (const [index, type] of ['hbrace', 'vbrace'].entries()) {
    const start = state.addNode(0, index * 4000);
    const end = state.addNode(3000, index * 4000 + (type === 'hbrace' ? 3000 : 0));
    state.addMember(start.id, end.id, {
      type, levelId: 'L0', topLevelId: type === 'vbrace' ? 'L1' : null,
    });
  }
  const model = state.toJSON();
  await importModel(page, model);
  for (const member of model.members) {
    const dialog = await openList(page);
    await dialog.getByRole('combobox', { name: '要素の種類', exact: true }).selectOption('member');
    await dialog.getByRole('combobox', { name: '線材種別で絞り込み', exact: true }).selectOption(member.type);
    await expect(dialog.locator('tbody tr')).toHaveCount(1);
    await expect(dialog.locator('tbody button')).toHaveText(member.id);
    if (member.type === 'hbrace') {
      await dialog.getByRole('button', { name: '検索結果の線材 1 件を一括選択', exact: true }).click();
    } else {
      await dialog.getByRole('button', { name: `${member.id} を選択`, exact: true }).click();
    }
    await expect(dialog).toBeHidden();
    await expect(page.locator('#selection-summary')).toHaveText(`選択中: ${member.id}`);
  }
  expect((await savedModel(page)).members).toEqual(model.members);
});
