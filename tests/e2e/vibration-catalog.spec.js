import { test, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
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

async function openDefinitions(page) {
  await page.locator('#menu-model-trigger').click();
  await page.locator('#btn-open-user-def').click();
  await expect(page.locator('#user-def-modal')).toBeVisible();
}
async function closeDefinitions(page, list = false) {
  if (list) await page.locator('#btn-user-def-list-close').click();
  await page.locator('#btn-user-def-close').click();
}
async function savedModel(page) {
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CAD保存', exact: true }).click();
  return JSON.parse(await readFile(await (await download).path(), 'utf8'));
}
async function savedDefinitions(page) {
  await openDefinitions(page);
  const download = page.waitForEvent('download');
  await page.locator('#btn-user-def-export').click();
  const definitions = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  await closeDefinitions(page);
  return definitions;
}
async function loadSample(page, filename) {
  const sample = JSON.parse(await readFile(new URL(`../../test/fixtures/vibration/${filename.replace('.json', '.schema13.json')}`, import.meta.url), 'utf8'));
  await page.locator('#file-import').setInputFiles({ name: filename, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sample)) });
  await expect(page.locator('.app-notice-success')).toBeVisible();
  return sample;
}
async function reviewScreenshot(page, name) {
  if (!process.env.E2E_REVIEW_DIR || test.info().project.name !== 'chromium') return;
  await mkdir(process.env.E2E_REVIEW_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.E2E_REVIEW_DIR, `${name}.png`), fullPage: true });
}
async function selectSurface(page, id) {
  await page.locator('#menu-model-trigger').click();
  await page.getByRole('button', { name: '要素一覧…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '要素一覧', exact: true });
  await dialog.getByLabel('ID・断面を検索').fill(id);
  await dialog.getByRole('button', { name: `${id} を選択`, exact: true }).click();
  await expect(page.locator('#prop-surface-unit-weight')).toBeVisible();
}

// Public controls and exported files verify the new metadata survives actual
// browser input, transactional table edits, Undo and schema-13 imports.
test('directional stiffness supports scientific numbers, pin/rigid, validation and Undo', async ({ page }) => {
  await openDefinitions(page);
  await page.locator('#user-def-kind').selectOption('spring');
  await page.locator('#user-def-symbol').fill('directional');
  await page.locator('#user-def-kr').fill('4.0e7');
  await page.locator('#user-def-krY').fill('0');
  await page.locator('#user-def-krZ').fill('rigid');
  await page.locator('#btn-user-def-add').click();
  await expect(page.locator('#user-def-form-error')).toContainText('0・負値');
  await page.locator('#user-def-krY').fill('pin');
  await reviewScreenshot(page, 'vibration-directional-spring-form');
  await page.locator('#btn-user-def-add').click();
  await expect(page.locator('#user-def-form-error')).toBeHidden();
  await page.locator('#user-def-kind').selectOption('spring');
  await page.locator('#btn-user-def-list').click();
  const row = page.locator('#user-def-list-body tr').filter({ has: page.locator('button[data-symbol="directional"]') });
  await expect(row.locator('[data-field="krY"]')).toHaveValue('pin');
  await expect(row.locator('[data-field="krZ"]')).toHaveValue('rigid');
  await row.locator('[data-field="krY"]').fill('bad');
  await row.locator('[data-action="save-spring"]').click();
  await expect(row.locator('[data-field="krY"]')).toHaveClass(/input-error/);
  await row.locator('[data-field="krY"]').fill('2e7');
  await row.locator('[data-field="kt"]').fill('pin');
  await row.locator('[data-action="save-spring"]').click();
  await closeDefinitions(page, true);
  expect((await savedDefinitions(page)).springs.find(s => s.symbol === 'directional')).toMatchObject({ kr: 4e7, krY: 2e7, krZ: 'rigid', kt: 'pin' });
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await savedDefinitions(page)).springs.find(s => s.symbol === 'directional')).toMatchObject({ kr: 4e7, krY: 'pin', krZ: 'rigid', kt: null });
});

test('section source, designation and absolute shear areas are editable and calculation marks provenance', async ({ page }) => {
  await openDefinitions(page);
  await page.locator('#user-def-name').fill('H-catalog');
  await page.locator('#user-def-b').fill('80');
  await page.locator('#user-def-h').fill('160');
  await page.locator('#user-def-shape').selectOption('hSection');
  await page.locator('#user-def-web-thickness').fill('6');
  await page.locator('#user-def-flange-thickness').fill('8');
  await page.locator('#user-def-designation').fill('H-160x80x6x8');
  await page.locator('#btn-user-def-calculate-properties').click();
  await expect(page.locator('#user-def-property-source')).toHaveValue('computed');
  await page.locator('#user-def-property-source').selectOption('catalog');
  await page.locator('#user-def-Iy').fill('8.5e6');
  await page.locator('#user-def-Avy').fill('0');
  await page.locator('#btn-user-def-add').click();
  await expect(page.locator('#user-def-form-error')).toBeVisible();
  await page.locator('#user-def-Avy').fill('8.0e2');
  await page.locator('#btn-user-def-add').click();
  await page.locator('#btn-user-def-list').click();
  const row = page.locator('#user-def-list-body tr').filter({ has: page.locator('button[data-name="H-catalog"]') });
  await expect(row.locator('[data-field="propertySource"]')).toHaveValue('catalog');
  await row.locator('[data-field="propertySource"]').selectOption('manual');
  await row.locator('[data-field="Avz"]').fill('7.2e2');
  await row.locator('[data-action="save-section"]').click();
  await closeDefinitions(page, true);
  expect((await savedDefinitions(page)).sections.find(s => s.name === 'H-catalog')).toMatchObject({ designation: 'H-160x80x6x8', propertySource: 'manual', Iy: 8.5e6, Avy: 800, Avz: 720 });
});

for (const filename of ['simple.json', 'split.json']) {
  test(`${filename}: density weight preserves incomplete values and updates placed surfaces`, async ({ page }) => {
    const sample = await loadSample(page, filename);
    await openDefinitions(page);
    await page.locator('#user-def-target').selectOption('surface');
    await page.locator('#user-def-name').fill('Incomplete floor');
    await page.locator('#user-def-section-material').selectOption('SyntheticPanel');
    await page.locator('#user-def-self-weight-mode').selectOption('fromDensity');
    await expect(page.locator('#user-def-surface-weight-preview')).toContainText('面材板厚');
    await page.locator('#user-def-thickness').fill('7.5e1');
    await page.locator('#user-def-additional-weight').fill('0');
    await expect(page.locator('#user-def-surface-weight-preview')).toContainText('353.0394');
    await page.locator('#user-def-additional-weight').fill('');
    await page.locator('#btn-user-def-add').click();
    await page.locator('#user-def-target').selectOption('surface');
    await page.locator('#btn-user-def-list').click();
    const row = page.locator('#user-def-list-body tr').filter({ has: page.locator('button[data-name="SyntheticFloor"]') });
    await expect(row.locator('[data-field="material"]')).toHaveValue('SyntheticPanel');
    await row.locator('[data-field="thickness"]').fill('75');
    await row.locator('[data-field="selfWeightMode"]').selectOption('fromDensity');
    await row.locator('[data-action="save-section"]').click();
    await expect(row.locator('[data-field="weightPreview"]')).toContainText('付加重量');
    await reviewScreenshot(page, `vibration-surface-catalog-${filename.replace('.json', '')}`);
    await closeDefinitions(page, true);
    const incomplete = await savedModel(page);
    expect((await savedDefinitions(page)).sections.find(s => s.name === 'Incomplete floor')).toMatchObject({ material: 'SyntheticPanel', thickness: 75, selfWeightMode: 'fromDensity', additionalWeight: null });
    expect(incomplete.surfaces[0].unitWeight).toBe(sample.surfaces[0].unitWeight);
    await selectSurface(page, sample.surfaces[0].id);
    await expect(page.locator('#prop-surface-weight-note')).toContainText('付加重量');
    await expect(page.locator('#prop-surface-unit-weight')).not.toHaveAttribute('readonly');
    await openDefinitions(page);
    await page.locator('#user-def-target').selectOption('surface');
    await page.locator('#btn-user-def-list').click();
    await row.locator('[data-field="additionalWeight"]').fill('-1');
    await row.locator('[data-action="save-section"]').click();
    await expect(row.locator('[data-field="additionalWeight"]')).toHaveClass(/input-error/);
    await row.locator('[data-field="additionalWeight"]').fill('125');
    await expect(row.locator('[data-field="weightPreview"]')).toContainText('478.0394');
    await row.locator('[data-action="save-section"]').click();
    await expect(row.locator('[data-field="additionalWeight"]')).not.toHaveClass(/input-error/);
    await expect(row.locator('[data-field="additionalWeight"]')).toHaveValue('125');
    await closeDefinitions(page, true);
    await expect(page.locator('#prop-surface-unit-weight')).toHaveAttribute('readonly');
    await expect(page.locator('#prop-surface-weight-note')).toContainText('478.0394');
    const updated = await savedModel(page);
    for (const surface of updated.surfaces.filter(s => s.sectionName === 'SyntheticFloor')) expect(surface.unitWeight).toBeCloseTo(478.0394, 7);
    expect(updated.sectionCatalog.find(s => s.name === 'SyntheticFloor')).toMatchObject({ material: 'SyntheticPanel', thickness: 75, selfWeightMode: 'fromDensity', additionalWeight: 125 });
    await page.getByRole('button', { name: '元に戻す', exact: true }).click();
    expect((await savedModel(page)).surfaces[0].unitWeight).toBe(sample.surfaces[0].unitWeight);
  });
}
